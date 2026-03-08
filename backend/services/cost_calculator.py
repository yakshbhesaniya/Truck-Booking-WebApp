from datetime import datetime

# ──────────────────────────────────────────────
#  Rate Constants
# ──────────────────────────────────────────────
HALT_RATE_PER_HOUR   = 100.0   # ₹100 per hour of halt at intermediate stops

TRUCK_CONFIG = {
    "light": {"label": "Light Truck (<1 t)",  "base_km": 20.0, "fixed": 100.0, "max_kg": 1000},
    "small": {"label": "Small Truck (1-3 t)", "base_km": 30.0, "fixed": 150.0, "max_kg": 3000},
    "big":   {"label": "Big Truck (3-10 t)",  "base_km": 45.0, "fixed": 250.0, "max_kg": 10000},
}

# ──────────────────────────────────────────────
#  Truck Allocation
# ──────────────────────────────────────────────
def determine_truck_allocation(weight_kg: float) -> dict:
    """
    Returns the best truck type and number of trucks needed.
    For loads >10 t, add one extra big truck per additional 10 t block.
    """
    w = float(weight_kg)
    if w <= 1000:
        return {"type": "light", "num_trucks": 1}
    if w <= 3000:
        return {"type": "small", "num_trucks": 1}
    if w <= 10000:
        return {"type": "big",   "num_trucks": 1}
    # > 10 t  →  multiple big trucks
    full_trucks = int(w // 10000)
    remainder   = w % 10000
    num_trucks  = full_trucks + (1 if remainder > 0 else 0)
    return {"type": "big", "num_trucks": num_trucks}


# ──────────────────────────────────────────────
#  Traffic factor (time of day)
# ──────────────────────────────────────────────
def traffic_factor() -> float:
    h = datetime.now().hour
    if 8 <= h <= 10 or 17 <= h <= 19:
        return 1.25
    if 12 <= h <= 13:
        return 1.10
    return 1.0


# ──────────────────────────────────────────────
#  Main Cost Calculator
# ──────────────────────────────────────────────
def calculate_cost(distance_km: float, weight_kg: float,
                   num_trucks: int = 1, halt_minutes: float = 0) -> float:
    """
    Full fare calculation:
      base_distance_cost  = base_rate_per_km * distance_km
      fixed charges
      traffic multiplier
      per extra truck: adds a full single-truck fare
      halt charges: ₹100 / hour (prorated to seconds)
    """
    alloc = determine_truck_allocation(weight_kg)
    truck_type = alloc["type"]
    cfg = TRUCK_CONFIG[truck_type]

    single_truck_fare = (cfg["base_km"] * distance_km + cfg["fixed"]) * traffic_factor()
    total_fare = single_truck_fare * num_trucks           # each truck costs the same
    halt_charge = (halt_minutes / 60.0) * HALT_RATE_PER_HOUR
    return round(total_fare + halt_charge, 2)


def get_cost_breakdown(distance_km: float, weight_kg: float,
                       halt_minutes: float = 0,
                       manual_trucks: dict = None) -> dict:
    """Returns a detailed breakdown dictionary for the estimate API."""
    tf = traffic_factor()
    halt_charge = round((halt_minutes / 60.0) * HALT_RATE_PER_HOUR, 2)
    
    # If no manual trucks are specified or all are 0, use auto allocation
    if not manual_trucks or not any(manual_trucks.values()):
        alloc = determine_truck_allocation(weight_kg)
        truck_mix = {alloc["type"]: alloc["num_trucks"]}
    else:
        truck_mix = {k: int(v) for k, v in manual_trucks.items() if int(v) > 0}

    total_fare = 0.0
    total_trucks = 0
    mix_details = []
    
    for t_type, count in truck_mix.items():
        cfg = TRUCK_CONFIG.get(t_type, TRUCK_CONFIG["big"])
        base_fare = cfg["base_km"] * distance_km + cfg["fixed"]
        per_truck = round(base_fare * tf, 2)
        total_fare += per_truck * count
        total_trucks += count
        mix_details.append({
            "type": t_type,
            "label": cfg["label"],
            "count": count,
            "per_truck_cost": per_truck
        })

    # For backward compatibility with UI, set the primary truck type as the largest in the mix
    primary_type = "light"
    if "big" in truck_mix: primary_type = "big"
    elif "small" in truck_mix: primary_type = "small"

    total = round(total_fare + halt_charge, 2)

    return {
        "truck_type":       primary_type,
        "truck_label":      "Mixed Trucks" if len(mix_details) > 1 else mix_details[0]["label"],
        "num_trucks":       total_trucks,
        "truck_mix":        mix_details,
        "halt_charge":      halt_charge,
        "traffic_factor":   tf,
        "total_cost":       total,
    }
