"""
route_optimizer.py
Computes routes between two or more waypoints.
- Big trucks (>3 t) use driving-hgv profile on ORS.
- Light/small trucks use driving-car profile on ORS.
- Falls back to OSRM, then haversine straight-line.
"""

import os, requests
from dotenv import load_dotenv
load_dotenv()

ORS_KEY = os.getenv("OPENROUTESERVICE_API_KEY")
ORS_BASE = "https://api.openrouteservice.org/v2/directions"


# ──────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────
def _haversine_km(lon1, lat1, lon2, lat2):
    from math import radians, cos, sin, asin, sqrt
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 6371.0 * 2 * asin(sqrt(a))


def _stitch_segments(segments: list) -> dict:
    """Merge a list of GeoJSON LineString geometries into one."""
    coords = []
    for seg in segments:
        if seg and seg.get("coordinates"):
            coords.extend(seg["coordinates"])
    return {"type": "LineString", "coordinates": coords}


# ──────────────────────────────────────────────
#  Single-leg route  (two waypoints)
# ──────────────────────────────────────────────
def _route_pair(start_lnglat, end_lnglat, truck_type="small"):
    """
    Route between two points.  Returns {"distance_m", "duration_s", "geojson"}.
    """
    profile = "driving-hgv" if truck_type == "big" else "driving-car"

    # 1) Try ORS
    if ORS_KEY:
        url = f"{ORS_BASE}/{profile}"
        headers = {"Authorization": ORS_KEY, "Content-Type": "application/json"}
        body = {
            "coordinates": [start_lnglat, end_lnglat],
            "instructions": False,
            "preference": "recommended",
        }
        if truck_type == "big":
            body["options"] = {
                "profile_params": {
                    "height": 4.0,       # metres
                    "weight": 10000,     # kg
                    "length": 12.0,
                    "width": 2.5,
                }
            }
        try:
            r = requests.post(url, json=body, headers=headers, timeout=10)
            r.raise_for_status()
            j = r.json()
            feat    = j["features"][0]
            summary = feat["properties"]["summary"]
            return {
                "distance_m": summary["distance"],
                "duration_s": summary["duration"],
                "geojson":    feat["geometry"],
            }
        except Exception:
            pass  # fall through

    # 2) Fallback: OSRM public (no vehicle type support)
    try:
        lon1, lat1 = start_lnglat
        lon2, lat2 = end_lnglat
        url = (
            f"https://router.project-osrm.org/route/v1/driving/"
            f"{lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson"
        )
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        j = r.json()
        route = j["routes"][0]
        return {
            "distance_m": route["distance"],
            "duration_s": route["duration"],
            "geojson":    route["geometry"],
        }
    except Exception:
        pass

    # 3) Last resort: haversine straight line
    lon1, lat1 = start_lnglat
    lon2, lat2 = end_lnglat
    km = _haversine_km(lon1, lat1, lon2, lat2)
    return {
        "distance_m": km * 1000,
        "duration_s": (km / 30.0) * 3600,
        "geojson": {
            "type": "LineString",
            "coordinates": [start_lnglat, end_lnglat],
        },
    }


# ──────────────────────────────────────────────
#  Public API
# ──────────────────────────────────────────────
def get_route_info(start_lnglat, end_lnglat, truck_type="small"):
    """
    Backward-compatible two-point route.
    start_lnglat / end_lnglat : [lng, lat]
    truck_type: "light" | "small" | "big"
    """
    return _route_pair(start_lnglat, end_lnglat, truck_type)


def get_multi_stop_route(waypoints_lnglat: list, truck_type: str = "small") -> dict:
    """
    Compute a chain route through 2+ waypoints.
    waypoints_lnglat: [[lng, lat], [lng, lat], ...]  (at least 2 items)

    Returns:
    {
        "distance_m": total distance,
        "duration_s": total duration,
        "geojson":    stitched LineString,
        "legs": [  # per-leg breakdown
            {"distance_m":…, "duration_s":…, "geojson":…},
            …
        ]
    }
    """
    if len(waypoints_lnglat) < 2:
        raise ValueError("Need at least 2 waypoints")

    legs = []
    total_dist = 0.0
    total_dur  = 0.0

    for i in range(len(waypoints_lnglat) - 1):
        seg = _route_pair(waypoints_lnglat[i], waypoints_lnglat[i + 1], truck_type)
        legs.append(seg)
        total_dist += seg["distance_m"]
        total_dur  += seg["duration_s"]

    all_geojsons = [leg["geojson"] for leg in legs]
    stitched = _stitch_segments(all_geojsons)

    return {
        "distance_m": total_dist,
        "duration_s": total_dur,
        "geojson":    stitched,
        "legs":       legs,
    }
