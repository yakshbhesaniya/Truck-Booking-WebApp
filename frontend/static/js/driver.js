/* ============================================================
   driver.js  –  Driver Portal Logic
   Features:
    • Truck type filter tabs (light / small / big / all)
    • Accept booking matching truck type
    • Arrive at stop / Depart stop with live halt timer
    • Mark loaded at pickup
    • Fleet tracking with typed truck markers
   ============================================================ */

const API = "/api/driver";
let map, vehicleMarker, currentBookingId = null;
let routeToPickupLayer = null, routeToDropLayer = null;
let stopLayers = [];
let pickupMarker = null, dropMarker = null;
let stopMarkers = [];
let staticMarkersById = {};
let assignedVehicleId = null;
let currentFilter = "";           // "" = all
let haltTimerInterval = null;
let haltStartTime = null;
let currentStopIndex = -1;
const TRUCK_BADGE_CLASS = { light: "type-light", small: "type-small", big: "type-big" };
const TRUCK_LABEL = { light: "Light", small: "Small", big: "Big" };

// ── Filter tabs ───────────────────────────────────────────────
function setFilter(type, el) {
  currentFilter = type;
  document.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active", "bg-primary", "text-white"));
  if (el) el.classList.add("active");
  loadPending();
}
window.setFilter = setFilter;

// ── Map helpers ───────────────────────────────────────────────
function clearRouteLayers() {
  if (routeToPickupLayer) { map.removeLayer(routeToPickupLayer); routeToPickupLayer = null; }
  if (routeToDropLayer) { map.removeLayer(routeToDropLayer); routeToDropLayer = null; }
  stopLayers.forEach(l => { try { map.removeLayer(l); } catch (e) { } });
  stopLayers = [];
}
function clearMarkers() {
  if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
  if (dropMarker) { map.removeLayer(dropMarker); dropMarker = null; }
  stopMarkers.forEach(m => { try { map.removeLayer(m); } catch (e) { } });
  stopMarkers = [];
}

// ── Load pending jobs ─────────────────────────────────────────
async function loadPending() {
  const url = currentFilter ? `${API}/pending?truck_type=${currentFilter}` : `${API}/pending`;
  const res = await fetch(url).catch(() => null);
  if (!res) return;
  const j = await res.json();
  const box = document.getElementById("pendingList");
  const cnt = document.getElementById("pendingCount");
  box.innerHTML = "";
  const list = j.pending || [];
  if (cnt) cnt.textContent = list.length;
  if (!list.length) {
    box.innerHTML = "<div class='text-muted small'>No pending requests</div>";
    return;
  }
  list.forEach(b => {
    let truckTitle = "";
    if (b.truck_mix && b.truck_mix.length > 0) {
      truckTitle = b.truck_mix.map(tm => `<span class="truck-pill ${TRUCK_BADGE_CLASS[tm.type] || 'type-small'} me-1 mb-1 d-inline-block">${tm.count}× ${tm.label}</span>`).join("");
    } else {
      const typeClass = TRUCK_BADGE_CLASS[b.truck_type] || "type-small";
      const typeLabel = TRUCK_LABEL[b.truck_type] || b.truck_type;
      const numStr = b.num_trucks > 1 ? ` × ${b.num_trucks}` : "";
      truckTitle = `<span class="truck-pill ${typeClass}">${typeLabel}${numStr}</span>`;
    }

    const stopsStr = (b.stops || []).length > 0 ? `<div class="text-muted small">🔀 ${b.stops.length} stop(s)</div>` : "";
    const div = document.createElement("div");
    div.className = "job-card";
    div.innerHTML = `
      <div class="d-flex justify-content-between mb-1 flex-wrap gap-1">
        <b class="font-monospace small">${b.id}</b>
        <div>${truckTitle}</div>
      </div>
      <div>${b.pickup} → ${b.drop}</div>
      ${stopsStr}
      <div class="fw-bold text-success mt-1">₹${b.cost}</div>
      <div class="text-muted small">${b.distance_km ? b.distance_km.toFixed(2) + " km" : ""} · ${b.weight_kg} kg</div>
      <button class="btn btn-sm btn-primary mt-2 w-100" onclick="accept('${b.id}', '${b.truck_type}')">Accept Job</button>
    `;
    box.appendChild(div);
  });
}

// ── Accept a job ──────────────────────────────────────────────
async function accept(bid, truckType) {
  // Pick a vehicle ID that matches truck type, else fallback
  const typeToId = { light: "LIGHT-1", small: "SMALL-1", big: "BIG-1" };
  const vehicleId = typeToId[truckType] || "BIG-1";
  assignedVehicleId = vehicleId;
  try {
    const res = await fetch(`${API}/accept`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_id: bid, vehicle_id: vehicleId }),
    });
    const j = await res.json();
    if (j.error) {
      alert(`Cannot Accept: ${j.error}`);
      loadPending(); // the job might have been auto-cancelled by the server
      return;
    }
  } catch (e) {
    alert(`Error accepting job: ${e.message}`);
    return;
  }

  currentBookingId = bid;
  localStorage.setItem("driverCurrentBookingId", currentBookingId);

  showActionsCard(true);
  document.getElementById("driverLoadedBtn").style.display = "none";
  document.getElementById("driverTripCard").style.display = "block";
  document.getElementById("noActionsText").classList.add("d-none");

  // Fetch booking details
  const [bj, db] = await Promise.all([
    fetch(`/api/user/booking/${bid}`).then(r => r.json()),
    fetch("/api/db").then(r => r.json()),
  ]);

  if (bj.booking) {
    fillDriverSummary(bj.booking);
    drawBookingRoutes(bj.booking, db);
  }
}
window.accept = accept;

// ── Mark loaded at pickup ─────────────────────────────────────
async function markLoaded() {
  if (!currentBookingId) return;
  const btn = document.getElementById("driverLoadedBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Confirming..."; }

  await fetch(`${API}/mark_loaded`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ booking_id: currentBookingId }),
  });
  // The backend will automatically start the trip if user has also confirmed.
  // We just poll for status updates.
}

// ── Arrive at stop ────────────────────────────────────────────
async function arriveStop(stopIdx) {
  if (!currentBookingId) return;
  const res = await fetch(`${API}/arrive_stop/${currentBookingId}/${stopIdx}`, { method: "POST" });
  const j = await res.json();
  if (j.ok) {
    haltStartTime = j.halt_start * 1000;   // ms
    currentStopIndex = stopIdx;
    startHaltTimer(stopIdx);
    renderStopActionsDriver(stopIdx, "arrived");
  }
}
window.arriveStop = arriveStop;

// ── Depart stop ───────────────────────────────────────────────
async function departStop(stopIdx) {
  if (!currentBookingId) return;
  const res = await fetch(`${API}/depart_stop/${currentBookingId}/${stopIdx}`, { method: "POST" });
  const j = await res.json();
  if (j.ok) {
    stopHaltTimer();
    currentStopIndex = -1;
    renderStopActionsDriver(stopIdx, "departed");
    // Update halt charge display
    document.getElementById("dSumHaltCharge").innerText = "₹" + (j.halt_charge || 0).toFixed(2);
    document.getElementById("dSumCost").innerText = j.new_total;
  }
}
window.departStop = departStop;

// ── Halt timer helpers ────────────────────────────────────────
function startHaltTimer(stopIdx) {
  stopHaltTimer();
  const section = document.getElementById("haltTimerSection");
  if (section) section.classList.remove("d-none");
  haltTimerInterval = setInterval(() => {
    const elapsed = (Date.now() - haltStartTime) / 1000;
    const h = Math.floor(elapsed / 3600).toString().padStart(2, "0");
    const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, "0");
    const s = Math.floor(elapsed % 60).toString().padStart(2, "0");
    const timerEl = document.getElementById("haltTimerDisplay");
    if (timerEl) timerEl.textContent = `${h}:${m}:${s}`;
    const accrued = (elapsed / 3600) * 100;
    const accruedEl = document.getElementById("haltAccruedDisplay");
    if (accruedEl) accruedEl.textContent = "₹" + accrued.toFixed(2);
  }, 1000);
}

function stopHaltTimer() {
  if (haltTimerInterval) { clearInterval(haltTimerInterval); haltTimerInterval = null; }
  const section = document.getElementById("haltTimerSection");
  if (section) section.classList.add("d-none");
}

// ── Render stop action buttons for driver ─────────────────────
function renderStopActionsDriver(activeStopIdx, phase) {
  const container = document.getElementById("stopActionsDriver");
  if (!container) return;
  if (phase === "arrived") {
    container.innerHTML = `
      <div class="alert alert-warning py-2 small mb-2">⏱ Halt timer running at Stop ${activeStopIdx + 1}. Halt charge: ₹100/hr.</div>
      <button class="btn btn-danger w-100 py-2 fw-semibold mb-2" onclick="departStop(${activeStopIdx})">
        🚚 Depart Stop ${activeStopIdx + 1}
      </button>`;
  } else if (phase === "departed") {
    container.innerHTML = `<div class="alert alert-success py-2 small">✓ Departed Stop ${activeStopIdx + 1}. Halt charge added.</div>`;
    setTimeout(() => { if (container) container.innerHTML = ""; }, 4000);
  }
}

// ── Draw booking routes on map ────────────────────────────────
function drawBookingRoutes(b, db) {
  clearRouteLayers();
  clearMarkers();

  const pLL = [b.pickup_coords[0], b.pickup_coords[1]];
  const dLL = [b.drop_coords[0], b.drop_coords[1]];
  pickupMarker = L.marker(pLL).addTo(map).bindPopup("Pickup");
  dropMarker = L.marker(dLL).addTo(map).bindPopup("Drop");

  // Stop markers
  (b.stops || []).forEach((s, i) => {
    if (!s.coords) return;
    const m = L.marker(s.coords).addTo(map).bindPopup(`Stop ${i + 1}: ${s.name}`);
    stopMarkers.push(m);
  });

  // To-pickup route (orange)
  if (b.to_pickup_geojson) {
    routeToPickupLayer = L.geoJSON(b.to_pickup_geojson, { style: { color: "#f97316", weight: 4 } }).addTo(map);
  } else if (db && db.vehicles) {
    const v = db.vehicles.find(x => x.id === assignedVehicleId);
    if (v) {
      const url = `https://router.project-osrm.org/route/v1/driving/${v.lng},${v.lat};${pLL[1]},${pLL[0]}?overview=full&geometries=geojson`;
      fetch(url).then(r => r.json()).then(data => {
        if (data.code === "Ok" && data.routes && data.routes.length > 0) {
          routeToPickupLayer = L.geoJSON(data.routes[0].geometry, { style: { color: "#f97316", dashArray: "5,5", weight: 3 } }).addTo(map);
        } else {
          routeToPickupLayer = L.polyline([[v.lat, v.lng], pLL], { color: "#f97316", dashArray: "5,5", weight: 3 }).addTo(map);
        }
      }).catch(() => {
        routeToPickupLayer = L.polyline([[v.lat, v.lng], pLL], { color: "#f97316", dashArray: "5,5", weight: 3 }).addTo(map);
      });
    }
  }

  // To-drop route (indigo)
  const dropGeom = b.to_drop_geojson || b.route_geojson;
  if (dropGeom) {
    routeToDropLayer = L.geoJSON(dropGeom, { style: { color: "#4338ca", weight: 5 } }).addTo(map);
  } else {
    const url = `https://router.project-osrm.org/route/v1/driving/${pLL[1]},${pLL[0]};${dLL[1]},${dLL[0]}?overview=full&geometries=geojson`;
    fetch(url).then(r => r.json()).then(data => {
      if (data.code === "Ok" && data.routes && data.routes.length > 0) {
        routeToDropLayer = L.geoJSON(data.routes[0].geometry, { style: { color: "#4338ca", weight: 5 } }).addTo(map);
      } else {
        routeToDropLayer = L.polyline([pLL, dLL], { color: "#4338ca", weight: 3 }).addTo(map);
      }
    }).catch(() => {
      routeToDropLayer = L.polyline([pLL, dLL], { color: "#4338ca", weight: 3 }).addTo(map);
    });
  }

  // Vehicle marker
  if (db && db.vehicles) {
    const v = db.vehicles.find(x => x.id === assignedVehicleId);
    if (v) {
      Object.keys(staticMarkersById).forEach(id => { try { map.removeLayer(staticMarkersById[id]); } catch (e) { } });
      staticMarkersById = {};
      vehicleMarker = L.marker([v.lat, v.lng], {
        icon: L.icon({ iconUrl: "/static/images/truck_icon.png", iconSize: [40, 40] })
      }).addTo(map);
    }
  }

  // Fit map
  const layers = [routeToPickupLayer, routeToDropLayer, pickupMarker, dropMarker, vehicleMarker, ...stopMarkers].filter(Boolean);
  if (layers.length) {
    const g = L.featureGroup(layers);
    map.fitBounds(g.getBounds(), { padding: [40, 40] });
  }
}

// ── Poll booking status ───────────────────────────────────────
async function pollBookingStatus() {
  if (!currentBookingId) return;
  try {
    const bj = await fetch(`/api/user/booking/${currentBookingId}`).then(r => r.json());
    if (bj.error) return;
    const b = bj.booking;

    // Handle Cancelled by user
    if (b.status === "CANCELLED") {
      alert("This booking was cancelled by the user.");
      stopHaltTimer();
      localStorage.removeItem("driverCurrentBookingId");
      currentBookingId = null; assignedVehicleId = null; currentStopIndex = -1;
      showActionsCard(false);
      document.getElementById("driverTripCard").style.display = "none";
      clearRouteLayers(); clearMarkers();
      if (vehicleMarker) { map.removeLayer(vehicleMarker); vehicleMarker = null; }
      fetchPending(); // Refresh list
      return;
    }

    // Status badge
    const st = document.getElementById("dSumStatus");
    if (st) st.innerText = b.status || "-";

    // Driver Action Status & Pickup mark-loaded button
    const statusBox = document.getElementById("driverActionStatus");
    const dlBtn = document.getElementById("driverLoadedBtn");

    if (b.status === "ARRIVED_DRIVER") {
      if (!b.driver_loaded) {
        if (dlBtn) {
          dlBtn.style.display = "block";
          dlBtn.disabled = false;
          dlBtn.innerHTML = "📦 Confirm Cargo Loaded at Pickup";
        }
        if (statusBox) {
          statusBox.classList.remove("d-none", "alert-secondary", "alert-info");
          statusBox.classList.add("alert-warning");
          statusBox.innerHTML = "You have arrived. Load the cargo and confirm.";
        }
      } else if (!b.user_loaded) {
        if (dlBtn) dlBtn.style.display = "none";
        if (statusBox) {
          statusBox.classList.remove("d-none", "alert-warning", "alert-secondary");
          statusBox.classList.add("alert-info");
          statusBox.innerHTML = "⏳ Waiting for user to confirm cargo is loaded...";
        }
      }
    } else {
      if (dlBtn) dlBtn.style.display = "none";
      if (statusBox) statusBox.classList.add("d-none");
    }

    // Check if we arrived at a stop (status = AT_STOP_N) and timer not running
    const atStopMatch = (b.status || "").match(/^AT_STOP_(\d+)$/);
    if (atStopMatch && currentStopIndex < 0) {
      const idx = parseInt(atStopMatch[1]);
      const haltKey = `halt_start_${idx}`;
      if (b[haltKey]) {
        haltStartTime = b[haltKey] * 1000;
        currentStopIndex = idx;
        startHaltTimer(idx);
        renderStopActionsDriver(idx, "arrived");
      }
    }

    // Halt charge update
    const hcEl = document.getElementById("dSumHaltCharge");
    if (hcEl) hcEl.innerText = "₹" + ((b.halt_charge || 0)).toFixed(2);
    document.getElementById("dSumCost").innerText = b.cost;

    // Completed
    if (b.status === "COMPLETED" || b.status === "DELIVERED") {
      stopHaltTimer();
      localStorage.removeItem("driverCurrentBookingId");
      currentBookingId = null; assignedVehicleId = null; currentStopIndex = -1;
      showActionsCard(false);
      document.getElementById("driverTripCard").style.display = "none";
      clearRouteLayers(); clearMarkers();
      if (vehicleMarker) { map.removeLayer(vehicleMarker); vehicleMarker = null; }
      // redraw static trucks
      const db = await fetch("/api/db").then(r => r.json()).catch(() => ({ vehicles: [] }));
      (db.vehicles || []).forEach(v => {
        if (staticMarkersById[v.id]) return;
        const m = L.marker([v.lat, v.lng], {
          icon: L.icon({ iconUrl: "/static/images/truck_icon.png", iconSize: [40, 40] })
        }).addTo(map).bindPopup(v.name || v.id);
        staticMarkersById[v.id] = m;
      });
    }

    if (b.status === "LOADED" && !b.stops?.length) {
      try { await fetch(`${API}/start_drop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ booking_id: currentBookingId }) }); } catch (e) { }
    }

  } catch (e) { }
}

// ── Poll vehicle position ─────────────────────────────────────
async function pollVehicle() {
  const db = await fetch("/api/db").then(r => r.json()).catch(() => null);
  if (!db) return;
  if (currentBookingId && vehicleMarker && assignedVehicleId) {
    const v = (db.vehicles || []).find(x => x.id === assignedVehicleId);
    if (v) {
      vehicleMarker.setLatLng([v.lat, v.lng]);
      const posEl = document.getElementById("dSumPos");
      if (posEl) posEl.innerText = `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`;
    }
  } else {
    (db.vehicles || []).forEach(v => {
      const m = staticMarkersById[v.id];
      if (m) m.setLatLng([v.lat, v.lng]);
      else {
        const nm = L.marker([v.lat, v.lng], {
          icon: L.icon({ iconUrl: "/static/images/truck_icon.png", iconSize: [40, 40] })
        }).addTo(map).bindPopup(v.name || v.id);
        staticMarkersById[v.id] = nm;
      }
    });
  }
}

// ── Actions card show/hide ────────────────────────────────────
function showActionsCard(show) {
  const el = document.getElementById("actionsCard");
  if (el) el.style.display = show ? "block" : "none";
  const noTxt = document.getElementById("noActionsText");
  if (noTxt) noTxt.classList.toggle("d-none", show);
}

// ── Fill summary ──────────────────────────────────────────────
function fillDriverSummary(b) {
  if (!b) return;
  const km = typeof b.distance_km === "number" ? b.distance_km.toFixed(3) : "-";
  document.getElementById("dSumBookingId").innerText = b.id;
  document.getElementById("dSumPickup").innerText = b.pickup;
  document.getElementById("dSumDrop").innerText = b.drop;
  document.getElementById("dSumDistance").innerText = km + " km";
  document.getElementById("dSumEta").innerText = (b.eta_mins ? b.eta_mins.toFixed(1) : "-") + " mins";
  document.getElementById("dSumCost").innerText = b.cost;
  document.getElementById("dSumStatus").innerText = b.status || "-";
  document.getElementById("dSumHaltCharge").innerText = "₹" + ((b.halt_charge || 0)).toFixed(2);
  // Truck type
  const ttEl = document.getElementById("dSumTruckType");
  if (ttEl) {
    if (b.truck_mix && b.truck_mix.length > 0) {
      let mixHtml = "";
      b.truck_mix.forEach(tm => {
        mixHtml += `<span class="truck-pill ${TRUCK_BADGE_CLASS[tm.type] || 'type-small'} me-1 mb-1 d-inline-block">${tm.count}× ${tm.label}</span>`;
      });
      ttEl.innerHTML = mixHtml;
    } else if (b.truck_type) {
      const cls = TRUCK_BADGE_CLASS[b.truck_type] || "type-small";
      ttEl.innerHTML = `<span class="truck-pill ${cls}">${TRUCK_LABEL[b.truck_type] || b.truck_type}</span>`;
    }
  }
  const stopsEl = document.getElementById("dSumStops");
  const stopsRow = document.getElementById("dSumStopsRow");
  if ((b.stops || []).length > 0 && stopsEl && stopsRow) {
    stopsEl.innerText = b.stops.map(s => s.name).join(" → ");
    stopsRow.classList.remove("d-none");
  } else if (stopsRow) stopsRow.classList.add("d-none");
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  map = L.map("map").setView([19.1326, 72.9132], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

  document.getElementById("driverLoadedBtn").onclick = markLoaded;
  showActionsCard(false);
  document.getElementById("driverTripCard").style.display = "none";
  document.getElementById("driverLoadedBtn").style.display = "none";

  loadPending();
  setInterval(loadPending, 3000);
  setInterval(pollVehicle, 1000);
  setInterval(pollBookingStatus, 1500);

  // Session restore
  const storedId = localStorage.getItem("driverCurrentBookingId");
  if (storedId) {
    currentBookingId = storedId;
    showActionsCard(true);
    document.getElementById("driverTripCard").style.display = "block";
    try {
      const [bj, db] = await Promise.all([
        fetch(`/api/user/booking/${currentBookingId}`).then(r => r.json()),
        fetch("/api/db").then(r => r.json()),
      ]);
      if (!bj.error && bj.booking) {
        assignedVehicleId = bj.booking.assigned_vehicle;
        fillDriverSummary(bj.booking);
        drawBookingRoutes(bj.booking, db);
        // Restore halt timer if at a stop
        const b = bj.booking;
        const atStopMatch = (b.status || "").match(/^AT_STOP_(\d+)$/);
        if (atStopMatch) {
          const idx = parseInt(atStopMatch[1]);
          if (b[`halt_start_${idx}`]) {
            haltStartTime = b[`halt_start_${idx}`] * 1000;
            currentStopIndex = idx;
            startHaltTimer(idx);
            renderStopActionsDriver(idx, "arrived");
          }
        }
      } else {
        localStorage.removeItem("driverCurrentBookingId");
        currentBookingId = null;
        showActionsCard(false);
      }
    } catch (e) { }
  }
}

window.onload = init;
