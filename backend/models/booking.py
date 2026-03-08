"""
booking.py  –  Booking model backed by SQLite
All function signatures stay compatible with the JSON-based version
so that route handlers need no changes.
"""

import json, time, uuid
from backend.database.db import execute, fetchall, fetchone, clear_route_data, get_conn


# ─────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────
def _row_to_booking(row: dict) -> dict | None:
    if not row:
        return None
    b = dict(row)

    # Deserialise JSON blobs
    for key in ("route_geojson", "to_pickup_geojson", "to_drop_geojson"):
        val = b.get(key)
        b[key] = json.loads(val) if val else None

    # Leg geojsons stored as {"leg_0": {...}, ...}
    leg_data = b.pop("leg_geojsons", None)
    if leg_data:
        legs = json.loads(leg_data)
        b.update(legs)   # merge leg_0_geojson, leg_1_geojson, … into top-level

    # Extra dynamic fields (halt_start_N, user_stop_N_loaded, …)
    extra = b.pop("extra_fields", None)
    if extra:
        b.update(json.loads(extra))

    # Boolean ints → Python bool
    b["driver_loaded"] = bool(b.get("driver_loaded", 0))
    b["user_loaded"]   = bool(b.get("user_loaded",   0))

    # pickup_coords / drop_coords (compatibility)
    if b.get("pickup_lat") is not None:
        b["pickup_coords"] = [b["pickup_lat"], b["pickup_lng"]]
    if b.get("drop_lat") is not None:
        b["drop_coords"] = [b["drop_lat"], b["drop_lng"]]

    # Stops from booking_stops table
    stops = fetchall(
        "SELECT stop_index, name, lat, lng FROM booking_stops WHERE booking_id=? ORDER BY stop_index",
        (b["id"],),
    )
    b["stops"] = [{"index": s["stop_index"], "name": s["name"], "coords": [s["lat"], s["lng"]]} for s in stops]

    return b


# ─────────────────────────────────────────────────────────────
#  CRUD
# ─────────────────────────────────────────────────────────────
def create_booking(booking: dict) -> dict:
    """Insert a new booking from a dict (same interface as JSON version)."""
    bid        = booking.get("id") or ("BKG-" + uuid.uuid4().hex[:8])
    stops      = booking.pop("stops", [])
    pickup_c   = booking.pop("pickup_coords", [None, None])
    drop_c     = booking.pop("drop_coords",   [None, None])

    # Separate leg geojsons
    leg_dict = {}
    for k in list(booking.keys()):
        if k.startswith("leg_") and k.endswith("_geojson"):
            leg_dict[k] = booking.pop(k)

    extra = {}
    known = {"id","pickup","drop","weight_kg","truck_type","num_trucks","distance_km",
             "eta_mins","cost","halt_charge","status","assigned_vehicle","created_at",
             "driver_loaded","user_loaded","route_geojson","to_pickup_geojson","to_drop_geojson"}
    for k in list(booking.keys()):
        if k not in known:
            extra[k] = booking.pop(k)

    execute(
        """INSERT OR REPLACE INTO bookings(
            id, pickup, "drop", weight_kg, truck_type, num_trucks,
            distance_km, eta_mins, cost, halt_charge, status, assigned_vehicle,
            created_at, driver_loaded, user_loaded,
            pickup_lat, pickup_lng, drop_lat, drop_lng,
            route_geojson, to_pickup_geojson, to_drop_geojson,
            leg_geojsons, extra_fields
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            bid,
            booking.get("pickup"),  booking.get("drop"),
            booking.get("weight_kg", 0),
            booking.get("truck_type"),
            booking.get("num_trucks", 1),
            booking.get("distance_km"),
            booking.get("eta_mins"),
            booking.get("cost"),
            booking.get("halt_charge", 0),
            booking.get("status", "PENDING"),
            booking.get("assigned_vehicle"),
            booking.get("created_at", int(time.time())),
            int(booking.get("driver_loaded", False)),
            int(booking.get("user_loaded",   False)),
            pickup_c[0], pickup_c[1],
            drop_c[0],   drop_c[1],
            json.dumps(booking.get("route_geojson"))       if booking.get("route_geojson")      else None,
            json.dumps(booking.get("to_pickup_geojson"))   if booking.get("to_pickup_geojson")  else None,
            json.dumps(booking.get("to_drop_geojson"))     if booking.get("to_drop_geojson")    else None,
            json.dumps(leg_dict) if leg_dict else None,
            json.dumps(extra)    if extra    else None,
        ),
    )

    # Insert stops
    for s in stops:
        coords = s.get("coords", [None, None])
        execute(
            "INSERT OR REPLACE INTO booking_stops(booking_id,stop_index,name,lat,lng) VALUES(?,?,?,?,?)",
            (bid, s.get("index", 0), s.get("name"), coords[0], coords[1]),
        )

    booking["id"]           = bid
    booking["pickup_coords"] = pickup_c
    booking["drop_coords"]   = drop_c
    booking["stops"]         = stops
    return booking


def get_booking(booking_id: str) -> dict | None:
    row = fetchone("SELECT * FROM bookings WHERE id=?", (booking_id,))
    return _row_to_booking(row)


def list_bookings() -> list:
    rows = fetchall("SELECT * FROM bookings ORDER BY created_at DESC")
    return [_row_to_booking(r) for r in rows]


def update_booking(booking_id: str, updates: dict):
    """
    Flexible update: handles both known columns and dynamic extra_fields.
    If status → COMPLETED: triggers coordinate cleanup.
    """
    known_cols = {
        "status", "assigned_vehicle", "driver_loaded", "user_loaded",
        "halt_charge", "cost", "to_pickup_geojson", "to_drop_geojson",
        "route_geojson", "leg_geojsons",
    }
    # Fields that map to specific columns
    col_map = {
        "driver_loaded": lambda v: int(bool(v)),
        "user_loaded":   lambda v: int(bool(v)),
    }

    col_updates    = {}
    extra_updates  = {}
    leg_updates    = {}

    for k, v in updates.items():
        if k in known_cols:
            col_updates[k] = col_map.get(k, lambda x: x)(v)
        elif k.startswith("leg_") and k.endswith("_geojson"):
            leg_updates[k] = v
        else:
            extra_updates[k] = v

    # Serialise geojson blobs
    for jk in ("to_pickup_geojson", "to_drop_geojson", "route_geojson"):
        if jk in col_updates and isinstance(col_updates[jk], (dict, list)):
            col_updates[jk] = json.dumps(col_updates[jk])

    # Merge leg_updates into existing leg_geojsons
    if leg_updates:
        existing_raw = fetchone("SELECT leg_geojsons FROM bookings WHERE id=?", (booking_id,))
        existing = json.loads(existing_raw["leg_geojsons"]) if existing_raw and existing_raw.get("leg_geojsons") else {}
        existing.update(leg_updates)
        col_updates["leg_geojsons"] = json.dumps(existing)

    # Merge extra_updates into existing extra_fields
    if extra_updates:
        existing_raw = fetchone("SELECT extra_fields FROM bookings WHERE id=?", (booking_id,))
        existing = json.loads(existing_raw["extra_fields"]) if existing_raw and existing_raw.get("extra_fields") else {}
        existing.update(extra_updates)
        col_updates["extra_fields"] = json.dumps(existing)

    if col_updates:
        set_clause = ", ".join(f"{k}=?" for k in col_updates)
        vals       = list(col_updates.values()) + [booking_id]
        execute(f"UPDATE bookings SET {set_clause} WHERE id=?", tuple(vals))

    # Cleanup coordinates on completion
    if updates.get("status") in ("COMPLETED", "DELIVERED"):
        clear_route_data(booking_id)


# ─────────────────────────────────────────────────────────────
#  Legacy JSON compat (no-op stubs so no import errors if called)
# ─────────────────────────────────────────────────────────────
def load_db() -> dict:
    """
    Compatibility shim. Returns a dict resembling the old data.json
    structure so any legacy callers still work.
    """
    vehicles  = fetchall("SELECT * FROM vehicles")
    locs      = fetchall("SELECT * FROM locations")
    bookings  = list_bookings()
    return {
        "vehicles":  vehicles,
        "locations": {loc["name"]: {"lat": loc["lat"], "lng": loc["lng"]} for loc in locs},
        "bookings":  bookings,
    }


def save_db(db: dict):
    """No-op – data is persisted directly in SQLite."""
    pass
