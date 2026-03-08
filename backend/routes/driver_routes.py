"""
driver_routes.py  –  Driver-facing API
Supports:
  • Truck-type aware pending list
  • Accept booking (auto-match vehicle type)
  • Arrive / Depart intermediate stops with halt timing
  • Mark loaded at pickup
"""

import time
from flask import Blueprint, request, jsonify
from backend.models.booking import get_booking, update_booking, list_bookings
from backend.models.vehicle import update_vehicle_position, get_vehicle, update_vehicle
from backend.services.simulator import start_to_pickup, start_to_drop, start_multi_stop_simulation
from backend.services.route_optimizer import get_route_info
from backend.services.cost_calculator import HALT_RATE_PER_HOUR
from backend.database.db import fetchall

driver_bp = Blueprint("driver_bp", __name__)


# ─────────────────────────────────────────────
#  GET /api/driver/pending
# ─────────────────────────────────────────────
@driver_bp.route("/pending", methods=["GET"])
def list_pending():
    truck_type = request.args.get("truck_type")
    all_bookings = list_bookings()
    pending = [b for b in all_bookings if b.get("status") == "PENDING"]
    if truck_type:
        pending = [b for b in pending if b.get("truck_type") == truck_type]
    return jsonify({"pending": pending})


# ─────────────────────────────────────────────
#  POST /api/driver/accept   (JSON body)
# ─────────────────────────────────────────────
@driver_bp.route("/accept", methods=["POST"])
def accept_booking_json():
    data       = request.json or {}
    booking_id = data.get("booking_id")
    vehicle_id = data.get("vehicle_id", "BIG-1")
    if not booking_id:
        return jsonify({"error": "booking_id required"}), 400
    return _do_accept(booking_id, vehicle_id)


@driver_bp.route("/accept/<booking_id>", methods=["POST"])
def accept_booking(booking_id):
    data       = request.json or {}
    vehicle_id = data.get("vehicle_id", "BIG-1")
    return _do_accept(booking_id, vehicle_id)


def _do_accept(booking_id: str, vehicle_id: str):
    booking = get_booking(booking_id)
    if not booking:
        return jsonify({"error": "Booking not found"}), 404
    if booking.get("status") != "PENDING":
        return jsonify({"error": "Booking is not pending"}), 400

    # ── Compatibility Check: Big Trucks vs Narrow Roads ──
    v = get_vehicle(vehicle_id)
    if v and v.get("truck_type") == "big" and booking.get("truck_type") == "big":
        # Simulate check: if pickup or drop is a narrow location (e.g., Hostel/gate inner roads)
        narrow_locations = ["Hostel-12", "Hostel-3", "Narrow Street", "Market Road"]
        pickup_name = booking.get("pickup", "")
        drop_name   = booking.get("drop", "")
        is_narrow   = any(nl in pickup_name for nl in narrow_locations) or any(nl in drop_name for nl in narrow_locations)
        
        # Or check intermediate stops
        if not is_narrow and booking.get("stops"):
            stops = [s.get("name", "") for s in booking.get("stops", [])]
            is_narrow = any(any(nl in s_name for nl in narrow_locations) for s_name in stops)

        if is_narrow:
            # Auto-cancel the booking as it is physically impossible
            update_booking(booking_id, {"status": "CANCELLED"})
            err_msg = f"Incompatible Route: A Big Truck cannot navigate the narrow streets at this location. Booking {booking_id} has been automatically cancelled."
            return jsonify({"error": err_msg, "cancelled": True}), 400

    # Compute route from current vehicle position to pickup
    v = get_vehicle(vehicle_id)
    to_pickup_geom = None
    if v:
        pickup_lat, pickup_lng = booking["pickup_coords"]
        seg = get_route_info(
            [v["lng"], v["lat"]],
            [pickup_lng, pickup_lat],
            truck_type=booking.get("truck_type", "small"),
        )
        to_pickup_geom = seg.get("geojson")

    updates = {
        "status":           "ACCEPTED",
        "assigned_vehicle": vehicle_id,
    }
    if to_pickup_geom:
        updates["to_pickup_geojson"] = to_pickup_geom
    if booking.get("route_geojson"):
        updates["to_drop_geojson"] = booking["route_geojson"]

    update_booking(booking_id, updates)
    update_vehicle(vehicle_id, {"status": "ON_TRIP", "assigned_booking": booking_id})

    # Choose simulation mode
    has_stops = bool(booking.get("stops"))
    if has_stops:
        start_multi_stop_simulation(booking_id)
    else:
        start_to_pickup(booking_id)

    return jsonify({"ok": True, "booking_id": booking_id, "vehicle_id": vehicle_id})


# ─────────────────────────────────────────────
#  POST /api/driver/mark_loaded   (pickup)
# ─────────────────────────────────────────────
@driver_bp.route("/mark_loaded", methods=["POST"])
def driver_mark_loaded():
    data       = request.json or {}
    booking_id = data.get("booking_id")
    if not booking_id:
        return jsonify({"error": "booking_id required"}), 400
    b = get_booking(booking_id)
    if not b:
        return jsonify({"error": "not found"}), 404

    update_booking(booking_id, {"driver_loaded": True})
    b2 = get_booking(booking_id)

    # Both parties confirmed → start moving
    if b2.get("driver_loaded") and b2.get("user_loaded"):
        update_booking(booking_id, {"status": "LOADED"})
        if b2.get("stops"):          # multi-stop: sim is already running, it will unblock on LOADED status
            pass                     # sim thread polls status and proceeds when LOADED
        else:
            start_to_drop(booking_id)   # simple trip: kick off to-drop journey
        return jsonify({"ok": True, "started": True})

    # Driver confirmed but waiting for user
    return jsonify({"ok": True, "started": False, "msg": "Waiting for user to confirm loading"})


# ─────────────────────────────────────────────
#  POST /api/driver/arrive_stop/<bid>/<idx>
# ─────────────────────────────────────────────
@driver_bp.route("/arrive_stop/<bid>/<int:stop_idx>", methods=["POST"])
def arrive_stop(bid, stop_idx):
    """Driver signals arrival at intermediate stop stop_idx."""
    b = get_booking(bid)
    if not b:
        return jsonify({"error": "not found"}), 404
    now = int(time.time())
    update_booking(bid, {
        "status":                f"AT_STOP_{stop_idx}",
        f"halt_start_{stop_idx}": now,
    })
    return jsonify({"ok": True, "halt_start": now})


# ─────────────────────────────────────────────
#  POST /api/driver/depart_stop/<bid>/<idx>
# ─────────────────────────────────────────────
@driver_bp.route("/depart_stop/<bid>/<int:stop_idx>", methods=["POST"])
def depart_stop(bid, stop_idx):
    """
    Driver departs intermediate stop.
    Calculates halt duration, adds halt charge, updates booking cost.
    """
    b = get_booking(bid)
    if not b:
        return jsonify({"error": "not found"}), 404

    halt_start = b.get(f"halt_start_{stop_idx}")
    if halt_start is None:
        return jsonify({"error": "halt_start not set; call arrive_stop first"}), 400

    now           = int(time.time())
    halt_seconds  = max(0, now - halt_start)
    halt_minutes  = halt_seconds / 60.0
    halt_charge   = round((halt_minutes / 60.0) * HALT_RATE_PER_HOUR, 2)

    old_halt      = float(b.get("halt_charge", 0))
    old_cost      = float(b.get("cost", 0))
    new_halt      = old_halt + halt_charge
    new_cost      = round(old_cost + halt_charge, 2)

    update_booking(bid, {
        "status":                     f"DEPARTED_STOP_{stop_idx}",
        f"halt_end_{stop_idx}":       now,
        f"halt_minutes_{stop_idx}":   round(halt_minutes, 2),
        f"halt_charge_{stop_idx}":    halt_charge,
        "halt_charge":                new_halt,
        "cost":                       new_cost,
    })

    return jsonify({
        "ok":          True,
        "halt_minutes": round(halt_minutes, 2),
        "halt_charge":  halt_charge,
        "new_total":    new_cost,
    })


# ─────────────────────────────────────────────
#  POST /api/driver/update_status
# ─────────────────────────────────────────────
@driver_bp.route("/update_status", methods=["POST"])
def update_status():
    data       = request.json or {}
    booking_id = data.get("booking_id")
    status     = data.get("status")
    if not booking_id or not status:
        return jsonify({"error": "booking_id and status required"}), 400
    b = get_booking(booking_id)
    if not b:
        return jsonify({"error": "not found"}), 404
    update_booking(booking_id, {"status": status})
    return jsonify({"ok": True})


# ─────────────────────────────────────────────
#  POST /api/driver/location/<vehicle_id>
# ─────────────────────────────────────────────
@driver_bp.route("/location/<vehicle_id>", methods=["POST"])
def update_driver_location(vehicle_id):
    payload = request.json or {}
    lat = payload.get("lat")
    lng = payload.get("lng")
    if lat is None or lng is None:
        return jsonify({"error": "lat and lng required"}), 400
    v = update_vehicle_position(vehicle_id, lat, lng)
    return jsonify(v)


# ─────────────────────────────────────────────
#  POST /api/driver/complete/<booking_id>
# ─────────────────────────────────────────────
@driver_bp.route("/complete/<booking_id>", methods=["POST"])
def complete_booking(booking_id):
    b = get_booking(booking_id)
    if not b:
        return jsonify({"error": "not found"}), 404
    update_booking(booking_id, {"status": "COMPLETED"})
    vehicle_id = b.get("assigned_vehicle")
    if vehicle_id:
        update_vehicle(vehicle_id, {"status": "AVAILABLE", "assigned_booking": None})
    return jsonify({"ok": True})


# ─────────────────────────────────────────────
#  POST /api/driver/start_drop   (safety trigger)
# ─────────────────────────────────────────────
@driver_bp.route("/start_drop", methods=["POST"])
def force_start_drop():
    data       = request.json or {}
    booking_id = data.get("booking_id")
    if not booking_id:
        return jsonify({"error": "booking_id required"}), 400
    b = get_booking(booking_id)
    if not b:
        return jsonify({"error": "not found"}), 404
    if b.get("status") == "LOADED" and not b.get("stops"):
        start_to_drop(booking_id)
        return jsonify({"ok": True, "started": True})
    return jsonify({"ok": True, "started": False})


# ─────────────────────────────────────────────
#  GET /api/driver/all_vehicles
# ─────────────────────────────────────────────
@driver_bp.route("/all_vehicles", methods=["GET"])
def all_vehicles():
    from backend.models.vehicle import get_all_vehicles
    return jsonify({"vehicles": get_all_vehicles()})
