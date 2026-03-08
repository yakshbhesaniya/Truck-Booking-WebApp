"""
vehicle.py  –  Vehicle model backed by SQLite
"""

from backend.database.db import execute, fetchall, fetchone


def get_vehicle(vid: str) -> dict | None:
    return fetchone("SELECT * FROM vehicles WHERE id=?", (vid,))


def update_vehicle_position(vid: str, lat: float, lng: float) -> dict | None:
    """Update lat/lng for an existing vehicle (used by simulator every step)."""
    execute("UPDATE vehicles SET lat=?, lng=? WHERE id=?", (lat, lng, vid))
    return fetchone("SELECT * FROM vehicles WHERE id=?", (vid,))


def update_vehicle(vid: str, updates: dict) -> dict | None:
    """Update arbitrary vehicle attributes (status, assigned_booking)."""
    if not updates:
        return get_vehicle(vid)
    set_clause = ", ".join(f"{k}=?" for k in updates)
    vals       = list(updates.values()) + [vid]
    execute(f"UPDATE vehicles SET {set_clause} WHERE id=?", tuple(vals))
    return fetchone("SELECT * FROM vehicles WHERE id=?", (vid,))


def get_all_vehicles() -> list:
    return fetchall("SELECT * FROM vehicles")
