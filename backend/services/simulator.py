"""
simulator.py  –  Multi-leg, multi-stop simulation
Position updates run SYNCHRONOUSLY within each simulation thread (already a background thread)
so SQLite writes are always single-threaded per trip, no locking conflicts.
The ThreadPoolExecutor is kept only for launching simulation threads concurrently.
"""

import time, threading
from concurrent.futures import ThreadPoolExecutor
from backend.models.booking import get_booking, update_booking

# Executor used only for STARTING simulation threads, not for DB writes
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="sim")
_active   : dict[str, threading.Thread] = {}


# ─────────────────────────────────────────────────────────────
#  Internal: move vehicle along a single GeoJSON route
#  (runs synchronously on the simulation background thread)
# ─────────────────────────────────────────────────────────────
def _move_along(booking_id: str, geom: dict, vehicle_id: str):
    from backend.models.vehicle import update_vehicle_position
    coords = geom.get("coordinates", [])
    if not coords:
        print(f"[Sim] {booking_id}: no coordinates in geom, skipping move")
        return

    # Sub-sample to ≤150 steps for smooth, efficient animation
    if len(coords) > 150:
        step   = max(1, len(coords) // 150)
        coords = coords[::step]

    # Always include the last coord so we arrive exactly at destination
    if coords[-1] != geom["coordinates"][-1]:
        coords.append(geom["coordinates"][-1])

    sleep = 0.7 if len(coords) <= 60 else (0.5 if len(coords) > 120 else 0.6)
    print(f"[Sim] {booking_id}: moving through {len(coords)} waypoints (sleep={sleep}s each)")

    for i, c in enumerate(coords):
        try:
            # Direct synchronous call – this thread owns the write
            update_vehicle_position(vehicle_id, c[1], c[0])
            time.sleep(sleep)
        except Exception as e:
            print(f"[Sim] pos error @ step {i}: {e}")
            continue

    # Guarantee final position
    if coords:
        last = coords[-1]
        try:
            update_vehicle_position(vehicle_id, last[1], last[0])
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────
#  Wait polling helper
# ─────────────────────────────────────────────────────────────
def _wait_for(booking_id: str, predicate, timeout_s: int = 3600):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        b = get_booking(booking_id)
        if b and predicate(b):
            return True
        time.sleep(2.0)
    print(f"[Sim] {booking_id}: wait timed out after {timeout_s}s")
    return False


# ─────────────────────────────────────────────────────────────
#  Full multi-stop simulation
# ─────────────────────────────────────────────────────────────
def _simulate_multi_stop(booking_id: str):
    try:
        booking = get_booking(booking_id)
        if not booking:
            return

        vehicle_id = booking.get("assigned_vehicle", "BIG-1")
        stops      = booking.get("stops", [])

        # ── Leg 0: to pickup
        to_pickup = booking.get("to_pickup_geojson")
        if to_pickup:
            _move_along(booking_id, to_pickup, vehicle_id)
        update_booking(booking_id, {"status": "ARRIVED_DRIVER"})
        print(f"[Sim] {booking_id}: arrived at pickup")

        # Wait until both driver AND user have confirmed loaded OR backend already set LOADED
        _wait_for(
            booking_id,
            lambda b: b.get("status") == "LOADED"
                      or (b.get("driver_loaded") and b.get("user_loaded")),
            timeout_s=1800,
        )
        # Ensure status is LOADED so subsequent legs see correct state
        update_booking(booking_id, {"status": "LOADED"})


        # ── Intermediate stops
        for idx, stop in enumerate(stops):
            booking = get_booking(booking_id) or booking
            leg_key = f"leg_{idx}_geojson"
            legs    = booking.get("leg_geojsons") or {}
            geom    = booking.get(leg_key) or legs.get(leg_key)
            if geom:
                _move_along(booking_id, geom, vehicle_id)

            update_booking(booking_id, {
                "status":              f"AT_STOP_{idx}",
                f"halt_start_{idx}":   int(time.time()),
            })
            print(f"[Sim] {booking_id}: at stop {idx} ({stop.get('name')})")

            _wait_for(booking_id, lambda b, k=f"DEPARTED_STOP_{idx}": b.get("status") == k, timeout_s=7200)

        # ── Final leg: to drop
        booking   = get_booking(booking_id) or booking
        n         = len(stops)
        final_key = f"leg_{n}_geojson"
        legs      = booking.get("leg_geojsons") or {}
        final     = booking.get(final_key) or legs.get(final_key) \
                    or booking.get("to_drop_geojson") or booking.get("route_geojson")
        if final:
            _move_along(booking_id, final, vehicle_id)

        update_booking(booking_id, {"status": "COMPLETED"})
        print(f"[Sim] {booking_id}: trip completed (multi-stop)")

    except Exception as e:
        import traceback
        print(f"[Sim] Fatal error {booking_id}: {e}")
        traceback.print_exc()
    finally:
        _active.pop(f"{booking_id}_multi", None)


# ─────────────────────────────────────────────────────────────
#  Classic two-leg helpers (simple trips / backward compat)
# ─────────────────────────────────────────────────────────────
def simulate_move_along_route(booking_id: str, phase: str = "to_pickup"):
    try:
        booking = get_booking(booking_id)
        if not booking:
            return

        geom = booking.get("to_pickup_geojson") if phase == "to_pickup" \
               else (booking.get("to_drop_geojson") or booking.get("route_geojson"))

        if not geom:
            return

        vehicle_id = booking.get("assigned_vehicle", "BIG-1")
        _move_along(booking_id, geom, vehicle_id)

        new_status = "ARRIVED_DRIVER" if phase == "to_pickup" else "COMPLETED"
        update_booking(booking_id, {"status": new_status})
        print(f"[Sim] {booking_id}: {new_status}")

    except Exception as e:
        print(f"[Sim] Error {booking_id} ({phase}): {e}")
    finally:
        _active.pop(f"{booking_id}_{phase}", None)


def start_to_pickup(booking_id: str):
    key = f"{booking_id}_to_pickup"
    if key in _active and _active[key].is_alive():
        return
    t = threading.Thread(target=simulate_move_along_route, args=(booking_id, "to_pickup"),
                         name=f"sim_pickup_{booking_id}", daemon=False)
    _active[key] = t
    t.start()
    print(f"[Sim] started to_pickup for {booking_id}")


def start_to_drop(booking_id: str):
    key = f"{booking_id}_to_drop"
    if key in _active and _active[key].is_alive():
        return
    t = threading.Thread(target=simulate_move_along_route, args=(booking_id, "to_drop"),
                         name=f"sim_drop_{booking_id}", daemon=False)
    _active[key] = t
    t.start()
    print(f"[Sim] started to_drop for {booking_id}")


def start_multi_stop_simulation(booking_id: str):
    key = f"{booking_id}_multi"
    if key in _active and _active[key].is_alive():
        print(f"[Sim] multi already running for {booking_id}")
        return
    t = threading.Thread(target=_simulate_multi_stop, args=(booking_id,),
                         name=f"sim_multi_{booking_id}", daemon=False)
    _active[key] = t
    t.start()
    print(f"[Sim] started multi-stop for {booking_id}")


def start_simulation(booking_id: str):
    """Full simulation (legacy / debug trigger)."""
    key = f"{booking_id}_full"
    if key in _active and _active[key].is_alive():
        return

    def run():
        simulate_move_along_route(booking_id, "to_pickup")
        time.sleep(1)
        update_booking(booking_id, {"status": "LOADED"})
        simulate_move_along_route(booking_id, "to_drop")

    t = threading.Thread(target=run, name=f"sim_full_{booking_id}", daemon=False)
    _active[key] = t
    t.start()


def list_active_simulations():
    return [k for k, t in _active.items() if t.is_alive()]
