"""
user_routes.py  –  User-facing API
Supports:
  • Multi-stop estimates and bookings
  • Truck type auto-detection
  • Intermediate stop confirmation and halt tracking
"""

from flask import Blueprint, request, jsonify
from backend.services.route_optimizer import get_multi_stop_route, get_route_info
from backend.services.cost_calculator import get_cost_breakdown, calculate_cost, HALT_RATE_PER_HOUR
from backend.models.booking import create_booking, list_bookings, get_booking, update_booking
from backend.database.db import fetchall
import time, uuid

user_bp = Blueprint("user_bp", __name__)


def _get_locations_dict() -> dict:
    """Fetch locations from SQLite as {name: {lat, lng}} dict."""
    rows = fetchall("SELECT name, lat, lng FROM locations")
    return {r["name"]: {"lat": r["lat"], "lng": r["lng"]} for r in rows}


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────
def _resolve_location(name, locations_dict):
    if name not in locations_dict:
        return None
    loc = locations_dict[name]
    return [loc["lng"], loc["lat"]]   # [lng, lat] for routing


def _build_waypoints(pickup, stops, drop, loc_dict):
    """Build an ordered list of [lng,lat] waypoints: pickup → stops → drop."""
    pts = []
    for name in [pickup] + (stops or []) + [drop]:
        ll = _resolve_location(name, loc_dict)
        if ll is None:
            return None, name
        pts.append(ll)
    return pts, None


# ─────────────────────────────────────────────
#  GET /api/user/locations
# ─────────────────────────────────────────────
@user_bp.route("/locations", methods=["GET"])
def get_locations():
    locs = _get_locations_dict()
    return jsonify([{"name": k, "lat": v["lat"], "lng": v["lng"]} for k, v in locs.items()])


# ─────────────────────────────────────────────
#  POST /api/user/estimate
# ─────────────────────────────────────────────
@user_bp.route("/estimate", methods=["POST"])
def estimate():
    payload  = request.json or {}
    pickup   = payload.get("pickup")
    drop     = payload.get("drop")
    stops    = payload.get("stops", [])          # list of intermediate stop names
    weight   = float(payload.get("weight_kg", 0))
    manual_trucks = payload.get("manual_trucks")

    locs = _get_locations_dict()

    waypoints, bad = _build_waypoints(pickup, stops, drop, locs)
    if waypoints is None:
        return jsonify({"error": f"Unknown location: {bad}"}), 400

    from backend.services.cost_calculator import determine_truck_allocation, get_cost_breakdown
    
    if manual_trucks and any(int(v) > 0 for v in manual_trucks.values()):
        truck_type = "light"
        if int(manual_trucks.get("big", 0)) > 0: truck_type = "big"
        elif int(manual_trucks.get("small", 0)) > 0: truck_type = "small"
    else:
        alloc = determine_truck_allocation(weight)
        truck_type = alloc["type"]

    # ── Compatibility Check: Big Trucks vs Narrow Roads ──
    if truck_type == "big":
        narrow_locations = ["Hostel-12", "Hostel-3", "Narrow Street", "Market Road"]
        all_names = [pickup, drop] + stops
        if any(any(nl in name for nl in narrow_locations) for name in all_names):
            return jsonify({"error": "A Big Truck cannot navigate the narrow streets at your selected locations. Please select a smaller truck."}), 400

    route = get_multi_stop_route(waypoints, truck_type)
    breakdown = get_cost_breakdown(route["distance_m"] / 1000.0, weight,
                                   manual_trucks=manual_trucks)

    legs_info = [
        {
            "from": ([pickup] + stops)[i],
            "to":   (stops + [drop])[i],
            "distance_km": round(leg["distance_m"] / 1000.0, 3),
            "eta_mins":    round(leg["duration_s"]  / 60.0,   1),
        }
        for i, leg in enumerate(route["legs"])
    ]

    return jsonify({
        "distance_km":   round(route["distance_m"] / 1000.0, 3),
        "eta_mins":      round(route["duration_s"]  / 60.0,   1),
        "cost":          breakdown["total_cost"],
        "breakdown":     breakdown,
        "legs":          legs_info,
        "route_geojson": route["geojson"],
    })


# ─────────────────────────────────────────────
#  POST /api/user/book
# ─────────────────────────────────────────────
@user_bp.route("/book", methods=["POST"])
def book():
    payload = request.json or {}
    pickup  = payload.get("pickup")
    drop    = payload.get("drop")
    stops   = payload.get("stops", [])
    weight  = float(payload.get("weight_kg", 0))
    manual_trucks = payload.get("manual_trucks")

    locs = _get_locations_dict()

    waypoints, bad = _build_waypoints(pickup, stops, drop, locs)
    if waypoints is None:
        return jsonify({"error": f"Unknown location: {bad}"}), 400

    from backend.services.cost_calculator import determine_truck_allocation, get_cost_breakdown
    
    if manual_trucks and any(int(v) > 0 for v in manual_trucks.values()):
        truck_type = "light"
        if int(manual_trucks.get("big", 0)) > 0: truck_type = "big"
        elif int(manual_trucks.get("small", 0)) > 0: truck_type = "small"
        num_trucks = sum(int(v) for v in manual_trucks.values())
    else:
        alloc = determine_truck_allocation(weight)
        truck_type = alloc["type"]
        num_trucks = alloc["num_trucks"]

    # ── Compatibility Check: Big Trucks vs Narrow Roads ──
    if truck_type == "big":
        narrow_locations = ["Hostel-12", "Hostel-3", "Narrow Street", "Market Road"]
        all_names = [pickup, drop] + stops
        if any(any(nl in name for nl in narrow_locations) for name in all_names):
            return jsonify({"error": "A Big Truck cannot navigate the narrow streets at your selected locations. Please select a smaller truck."}), 400

    route      = get_multi_stop_route(waypoints, truck_type)
    breakdown  = get_cost_breakdown(route["distance_m"] / 1000.0, weight,
                                    manual_trucks=manual_trucks)

    # Build stop metadata list
    all_names   = [pickup] + stops + [drop]
    stops_meta  = []
    for i, name in enumerate(stops):
        loc = locs[name]
        stops_meta.append({
            "index":  i,
            "name":   name,
            "coords": [loc["lat"], loc["lng"]],
            "status": "pending",
        })

    # Per-leg geojson dict  leg_0_geojson … leg_N_geojson
    leg_geojsons = {f"leg_{i}_geojson": leg["geojson"] for i, leg in enumerate(route["legs"])}

    pickup_loc = locs[pickup]
    drop_loc   = locs[drop]

    booking_id = f"BKG-{str(uuid.uuid4())[:8]}"
    booking = {
        "id":            booking_id,
        "user_id":       payload.get("user_id", "guest"),
        "status":        "PENDING",
        "pickup":        pickup,
        "drop":          drop,
        "pickup_coords": [locs[pickup]["lat"], locs[pickup]["lng"]],
        "drop_coords":   [locs[drop]["lat"], locs[drop]["lng"]],
        "stops":         stops_meta,
        "weight_kg":     weight,
        "truck_type":    truck_type,
        "num_trucks":    num_trucks,
        "truck_mix":     breakdown.get("truck_mix", []),
        "distance_km":   round(route["distance_m"] / 1000.0, 3),
        "eta_mins":      round(route["duration_s"]  / 60.0,   1),
        "cost":          breakdown["total_cost"],
        "halt_charge":   0.0,
        "route_geojson": route["geojson"],
        "assigned_vehicle": None,
        "created_at":    int(time.time()),
        "driver_loaded": False,
        "user_loaded":   False,
    }
    booking.update(leg_geojsons)

    from backend.models.booking import create_booking
    create_booking(booking)
    return jsonify({"booking": booking})
# ─────────────────────────────────────────────
#  GET /api/user/bookings
# ─────────────────────────────────────────────
@user_bp.route("/bookings", methods=["GET"])
def bookings():
    return jsonify({"bookings": list_bookings()})


# ─────────────────────────────────────────────
#  GET /api/user/booking/<bid>
# ─────────────────────────────────────────────
@user_bp.route("/booking/<bid>", methods=["GET"])
def booking_get(bid):
    b = get_booking(bid)
    if not b:
        return jsonify({"error": "not found"}), 404
    return jsonify({"booking": b})


# ─────────────────────────────────────────────
#  POST /api/user/confirm_loaded   (pickup confirm)
# ─────────────────────────────────────────────
@user_bp.route("/confirm_loaded", methods=["POST"])
def user_confirm_loaded():
    payload    = request.json or {}
    booking_id = payload.get("booking_id")
    if not booking_id:
        return jsonify({"error": "booking_id required"}), 400
    b = get_booking(booking_id)
    if not b:
        return jsonify({"error": "not found"}), 404

    update_booking(booking_id, {"user_loaded": True})
    b2 = get_booking(booking_id)
    if b2.get("driver_loaded") and b2.get("user_loaded"):
        update_booking(booking_id, {"status": "LOADED"})
        # If multi-stop, do nothing here – simulator drives the flow
        if not b2.get("stops"):
            from backend.services.simulator import start_to_drop
            start_to_drop(booking_id)
    return jsonify({"ok": True})


# ─────────────────────────────────────────────
#  POST /api/user/confirm_stop/<bid>/<stop_idx>
# ─────────────────────────────────────────────
@user_bp.route("/confirm_stop/<bid>/<int:stop_idx>", methods=["POST"])
def confirm_stop(bid, stop_idx):
    """User confirms cargo loaded at intermediate stop stop_idx."""
    b = get_booking(bid)
    if not b:
        return jsonify({"error": "not found"}), 404
    update_booking(bid, {f"user_stop_{stop_idx}_loaded": True})
    return jsonify({"ok": True})


# ─────────────────────────────────────────────
#  POST /api/user/cancel   (cancel booking before load)
# ─────────────────────────────────────────────
@user_bp.route("/cancel", methods=["POST"])
def cancel_booking():
    payload    = request.json or {}
    booking_id = payload.get("booking_id")
    if not booking_id:
        return jsonify({"error": "booking_id required"}), 400
    
    b = get_booking(booking_id)
    if not b:
        return jsonify({"error": "not found"}), 404
    
    # Only allow cancel before truck is loaded and en route
    if b.get("status") in ("LOADED", "COMPLETED", "DELIVERED") or b.get("status").startswith("AT_STOP"):
        return jsonify({"error": "Cannot cancel after cargo is loaded and en route"}), 400
        
    update_booking(booking_id, {"status": "CANCELLED"})
    
    # If a vehicle was assigned, free it up
    vid = b.get("assigned_vehicle")
    if vid:
        from backend.models.vehicle import update_vehicle
        update_vehicle(vid, {"status": "AVAILABLE", "assigned_booking": None})
        
    return jsonify({"ok": True})
