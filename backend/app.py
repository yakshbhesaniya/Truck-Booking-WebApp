"""
app.py  –  Flask entry point
• SQLite DB initialised on startup (module-level, works with any runner)
• /api/db endpoint serves vehicle data from SQLite
• Thread pool executor used for async-style background tasks in simulator
"""

from flask import Flask, render_template, jsonify
from flask_cors import CORS
from backend.routes.user_routes import user_bp
from backend.routes.driver_routes import driver_bp
from backend.database.db import init_db, fetchall
from backend.models.vehicle import get_all_vehicles
import os
from backend.services.simulator import start_simulation

app = Flask(
    __name__,
    template_folder="../frontend/templates",
    static_folder="../frontend/static",
)
CORS(app)

app.register_blueprint(user_bp, url_prefix="/api/user")
app.register_blueprint(driver_bp, url_prefix="/api/driver")

# Initialise on module load (covers both `python -m backend.app` and WSGI)
with app.app_context():
    init_db()


# ─── HTML pages ──────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/user_panel")
def user_panel():
    return render_template("user_panel.html")

@app.route("/driver_panel")
def driver_panel():
    return render_template("driver_panel.html")

@app.route("/map_view")
def map_view():
    return render_template("map_view.html")


# ─── /api/db  (vehicle positions for the JS map) ─────────────
@app.route("/api/db")
def get_db():
    """Returns vehicle positions + location list from SQLite (replaces data.json)."""
    vehicles  = get_all_vehicles()
    locs_rows = fetchall("SELECT * FROM locations")
    locs_dict = {loc["name"]: {"lat": loc["lat"], "lng": loc["lng"]} for loc in locs_rows}
    return jsonify({"vehicles": vehicles, "locations": locs_dict})


# ─── Simulation trigger ───────────────────────────────────────
@app.route("/simulate/<booking_id>", methods=["POST"])
def run_simulation(booking_id):
    start_simulation(booking_id)
    return jsonify({"message": f"Simulation started for booking {booking_id}"})


# ─── Run ─────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(debug=True, port=port, use_reloader=True)
