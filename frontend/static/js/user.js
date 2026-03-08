/* ============================================================
   user.js  –  User Portal Logic
   Features:
    • multi-stop route building  (up to 3 intermediate stops)
    • truck type auto-detection badge
    • estimate with per-leg breakdown
    • booking with stop metadata
    • confirm-load buttons per stop
    • halt charge visibility in summary
   ============================================================ */

const API = "/api/user";
let map, routeLayer, routeToPickupLayer, vehicleMarker;
let bookingId = null, bookingData = null;
let pickupMarker = null, dropMarker = null;
let stopMarkers = [];
let locationsByName = {};
let staticMarkersById = {};
let stopCount = 0;
const MAX_STOPS = 3;
const TRUCK_BADGE_CLASS = { light: "truck-light", small: "truck-small", big: "truck-big" };
const TRUCK_LABEL = { light: "🚐 Light Truck (<1t)", small: "🚛 Small Truck (1-3t)", big: "🏗 Big Truck (>3t)" };

// Human-readable status labels shown to user
const STATUS_LABELS = {
  PENDING: "⏳ Waiting for driver to accept...",
  ACCEPTED: "✅ Driver accepted! Heading to pickup...",
  ARRIVED_DRIVER: "🚚 Driver has arrived at pickup",
  LOADED: "📦 Cargo loaded — en route to destination",
  COMPLETED: "🎉 Delivered!",
  DELIVERED: "🎉 Delivered!",
};
function friendlyStatus(status) {
  // Handle AT_STOP_N and DEPARTED_STOP_N dynamically
  if (!status) return '-';
  const atStop = status.match(/^AT_STOP_(\d+)$/);
  if (atStop) return `🛑 Truck at Stop ${parseInt(atStop[1]) + 1} — waiting for loading...`;
  const departed = status.match(/^DEPARTED_STOP_(\d+)$/);
  if (departed) return `🚚 Departed Stop ${parseInt(departed[1]) + 1} — continuing route`;
  return STATUS_LABELS[status] || status;
}

// ── Weight watch → live truck badge ──────────────────────────
function updateTruckBadge() {
  const w = parseFloat(document.getElementById("weight").value || 0);
  const badge = document.getElementById("truckBadge");
  let type, label;
  if (w <= 1000) { type = "light"; }
  else if (w <= 3000) { type = "small"; }
  else if (w <= 10000) { type = "big"; }
  else {
    const n = Math.ceil(w / 10000);
    type = "big";
    label = `🏗 Big Truck × ${n} trucks needed`;
  }
  label = label || TRUCK_LABEL[type];
  badge.innerHTML = `<span class="truck-badge ${TRUCK_BADGE_CLASS[type]}">${label}</span>`;
}

// ── Add / remove intermediate stop ───────────────────────────
function addStop() {
  if (stopCount >= MAX_STOPS) { alert("Max 3 intermediate stops allowed."); return; }
  const idx = stopCount++;
  const container = document.getElementById("stopsContainer");
  const row = document.createElement("div");
  row.className = "stop-row d-flex align-items-center gap-2";
  row.id = `stop-row-${idx}`;
  row.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="#64748b" class="bi bi-arrow-return-right flex-shrink-0" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5z"/>
    </svg>
    <select id="stop-${idx}" class="form-select form-select-sm bg-light" style="flex:1;"></select>
    <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="removeStop(${idx})" style="font-size:.8rem">✕</button>`;
  container.appendChild(row);

  // Populate options
  const sel = document.getElementById(`stop-${idx}`);
  Object.keys(locationsByName).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name; opt.textContent = name;
    sel.appendChild(opt);
  });

  // Hide estimate when stop changes
  sel.addEventListener("change", () => document.getElementById("estBoxCard").classList.add("d-none"));
  // And hide now since a stop was added
  document.getElementById("estBoxCard").classList.add("d-none");
}

// ── Reset Trip UI ─────────────────────────────────────────────
function resetTripUI() {
  localStorage.removeItem("bookingId");
  bookingId = null; bookingData = null;
  document.getElementById("bookingFormCard").style.display = "block";
  document.getElementById("tripSummaryCard").style.display = "none";
  document.getElementById("bookBtn").disabled = false;
  document.getElementById("estimateBtn").disabled = false;
  document.getElementById("bookBtn").textContent = "Confirm Booking";
  document.getElementById("driverTip").style.display = "block";
  document.getElementById("bookRes").innerHTML = "";

  const cBtn = document.getElementById("userCancelBtn");
  if (cBtn) { cBtn.disabled = false; cBtn.textContent = "Cancel Trip"; }

  clearMarkers(); clearRoutes();
}

window.addStop = addStop;

function removeStop(idx) {
  const row = document.getElementById(`stop-row-${idx}`);
  if (row) row.remove();
  stopCount = Math.max(0, stopCount - 1);
  document.getElementById("estBoxCard").classList.add("d-none");
}
window.removeStop = removeStop;

function getStops() {
  const stops = [];
  document.querySelectorAll("#stopsContainer select").forEach(sel => {
    if (sel.value) stops.push(sel.value);
  });
  return stops;
}

// ── Map helpers ───────────────────────────────────────────────
function clearRoutes() {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  if (routeToPickupLayer) { map.removeLayer(routeToPickupLayer); routeToPickupLayer = null; }
}
function clearMarkers() {
  if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
  if (dropMarker) { map.removeLayer(dropMarker); dropMarker = null; }
  stopMarkers.forEach(m => { try { map.removeLayer(m); } catch (e) { } });
  stopMarkers = [];
}
function addStopMarkers(stops) {
  (stops || []).forEach((s, i) => {
    if (!s.coords) return;
    const m = L.marker(s.coords, { title: s.name })
      .addTo(map)
      .bindPopup(`Stop ${i + 1}: ${s.name}`);
    stopMarkers.push(m);
  });
}
function showRoute(geojson, color = "#4338ca") {
  clearRoutes();
  if (geojson) {
    routeLayer = L.geoJSON(geojson, { style: { color, weight: 5 } }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });
  }
}
function showBothRoutes(toPickup, toDrop) {
  clearRoutes();
  const layers = [];
  if (toPickup) {
    routeToPickupLayer = L.geoJSON(toPickup, { style: { color: "#f97316", weight: 4 } }).addTo(map);
    layers.push(routeToPickupLayer);
  }
  if (toDrop) {
    routeLayer = L.geoJSON(toDrop, { style: { color: "#4338ca", weight: 5 } }).addTo(map);
    layers.push(routeLayer);
  }
  if (layers.length) {
    const g = L.featureGroup(layers);
    map.fitBounds(g.getBounds(), { padding: [50, 50] });
  }
}
function showRouteFallback(from, to) {
  clearRoutes();
  // Fetch real road route from public OSRM
  const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data.code === "Ok" && data.routes && data.routes.length > 0) {
        routeLayer = L.geoJSON(data.routes[0].geometry, { style: { color: "#4338ca", weight: 5 } }).addTo(map);
      } else {
        routeLayer = L.polyline([from, to], { color: "#4338ca" }).addTo(map);
      }
    })
    .catch(() => {
      // absolute fallback if offline
      routeLayer = L.polyline([from, to], { color: "#4338ca" }).addTo(map);
    });
  map.fitBounds(L.latLngBounds([from, to]), { padding: [50, 50] });
}

// ── Estimate ─────────────────────────────────────────────────
async function estimate() {
  const pickup = document.getElementById("pickup").value;
  const drop = document.getElementById("drop").value;
  const weight = parseFloat(document.getElementById("weight").value || 0);
  const manualTrucks = getManualTrucks();
  if (manualTrucks === false) return; // Validation failed
  const stops = getStops();

  if (!pickup || !drop) { alert("Select pickup and drop."); return; }
  if (pickup === drop) { alert("Pickup and Drop cannot be the same."); return; }

  const btn = document.getElementById("estimateBtn");
  btn.textContent = "Calculating…"; btn.disabled = true;

  try {
    const res = await fetch(`${API}/estimate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pickup, drop, stops, weight_kg: weight, manual_trucks: manualTrucks }),
    });
    const j = await res.json();
    if (j.error) { alert(j.error); return; }

    const bd = j.breakdown || {};
    const estHtml = `
      <div class="fw-bold text-dark mb-1">₹${j.cost} &nbsp;<span class="truck-badge ${TRUCK_BADGE_CLASS[bd.truck_type] || 'truck-small'}">${TRUCK_LABEL[bd.truck_type] || bd.truck_label}</span></div>
      <div class="text-muted">📏 ${j.distance_km} km &nbsp; ⏱ ${j.eta_mins} mins</div>
      ${bd.num_trucks > 1 ? `<div class="text-warning fw-bold">⚠ ${bd.num_trucks} trucks required</div>` : ""}
    `;
    document.getElementById("estBox").innerHTML = estHtml;
    document.getElementById("estBoxCard").classList.remove("d-none");

    // per-leg breakdown
    let legsHtml = "";
    (j.legs || []).forEach((leg, i) => {
      legsHtml += `<div class="leg-item">Leg ${i + 1}: <b>${leg.from}</b> → <b>${leg.to}</b> — ${leg.distance_km} km, ${leg.eta_mins} min</div>`;
    });
    document.getElementById("legsBox").innerHTML = legsHtml;

    // draw route
    clearMarkers();
    if (locationsByName[pickup]) pickupMarker = L.marker(locationsByName[pickup]).addTo(map).bindPopup("Pickup");
    if (locationsByName[drop]) dropMarker = L.marker(locationsByName[drop]).addTo(map).bindPopup("Drop");
    stops.forEach((s, i) => {
      if (locationsByName[s]) {
        const m = L.marker(locationsByName[s]).addTo(map).bindPopup(`Stop ${i + 1}: ${s}`);
        stopMarkers.push(m);
      }
    });
    if (j.route_geojson) showRoute(j.route_geojson);
    else if (locationsByName[pickup] && locationsByName[drop]) showRouteFallback(locationsByName[pickup], locationsByName[drop]);

  } catch (e) { alert("Error: " + e.message); }
  finally { btn.textContent = "Calculate Fare"; btn.disabled = false; }
}

// ── Book ─────────────────────────────────────────────────────
async function book() {
  const pickup = document.getElementById("pickup").value;
  const drop = document.getElementById("drop").value;
  const weight = parseFloat(document.getElementById("weight").value || 0);
  const manualTrucks = getManualTrucks();
  if (manualTrucks === false) return;
  const stops = getStops();
  if (pickup === drop) { alert("Pickup and Drop cannot be the same."); return; }

  const btn = document.getElementById("bookBtn");
  btn.textContent = "Booking…"; btn.disabled = true;

  try {
    const res = await fetch(`${API}/book`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pickup, drop, stops, weight_kg: weight, manual_trucks: manualTrucks }),
    });
    const j = await res.json();
    if (j.error) { alert(j.error); return; }

    bookingData = j.booking;
    bookingId = j.booking.id;
    localStorage.setItem("bookingId", bookingId);

    // Don't show form card tip — switch to trip summary immediately
    document.getElementById("bookBtn").disabled = true;
    document.getElementById("estimateBtn").disabled = true;
    document.getElementById("bookingFormCard").style.display = "none";
    document.getElementById("tripSummaryCard").style.display = "block";

    // Hide static tip (user already knows to open driver panel)
    const tip = document.getElementById("driverTip");
    if (tip) tip.style.display = "none";

    // Show waiting message in status bar
    document.getElementById("statusText").innerText = friendlyStatus("PENDING");
    document.getElementById("sumStatus").innerText = "PENDING";

    fillUserSummary(j.booking);
    clearMarkers();
    const pLL = [j.booking.pickup_coords[0], j.booking.pickup_coords[1]];
    const dLL = [j.booking.drop_coords[0], j.booking.drop_coords[1]];
    pickupMarker = L.marker(pLL).addTo(map).bindPopup("Pickup");
    dropMarker = L.marker(dLL).addTo(map).bindPopup("Drop");
    addStopMarkers(j.booking.stops);
    if (j.booking.route_geojson) showRoute(j.booking.route_geojson);
    else showRouteFallback(pLL, dLL);

  } catch (e) { alert("Error: " + e.message); }
  finally { btn.textContent = "Confirm Booking"; }
}

// ── Confirm loaded (pickup) ───────────────────────────────────
async function confirmUserLoaded() {
  if (!bookingId) return;
  const btn = document.getElementById("userLoadedBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Confirming..."; }

  await fetch(`${API}/confirm_loaded`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ booking_id: bookingId }),
  });
}

// ── Confirm loaded at stop idx ────────────────────────────────
async function confirmStopLoaded(idx) {
  if (!bookingId) return;
  await fetch(`${API}/confirm_stop/${bookingId}/${idx}`, { method: "POST" });
  const btn = document.getElementById(`userStopBtn-${idx}`);
  if (btn) { btn.disabled = true; btn.textContent = "✓ Confirmed"; }
}
window.confirmStopLoaded = confirmStopLoaded;

// ── Cancel Booking ──────────────────────────────────────────────
async function cancelBooking() {
  if (!bookingId) return;
  if (!confirm("Are you sure you want to cancel this booking?")) return;

  const btn = document.getElementById("userCancelBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Cancelling..."; }

  const res = await fetch(`${API}/cancel`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ booking_id: bookingId }),
  });
  const j = await res.json();
  if (j.error) {
    alert("Cancellation failed: " + j.error);
    if (btn) { btn.disabled = false; btn.textContent = "Cancel Trip"; }
  }
}
window.cancelBooking = cancelBooking;

// ── Poll booking state ────────────────────────────────────────
async function pollBooking() {
  if (!bookingId) return;
  const res = await fetch(`${API}/booking/${bookingId}`);
  const j = await res.json();
  if (j.error) return;
  const b = j.booking;

  // If driver cancelled or user cancelled
  if (b.status === "CANCELLED") {
    alert("This booking has been cancelled.");
    resetTripUI();
    return;
  }

  // Update status bar with human-friendly message
  const label = friendlyStatus(b.status);
  document.getElementById("statusText").innerText = label;
  document.getElementById("sumStatus").innerText = b.status || '-';
  fillUserSummary(b);

  // User Action Status & Buttons
  const statusBox = document.getElementById("userActionStatus");
  const ulBtn = document.getElementById("userLoadedBtn");
  const cancelBtn = document.getElementById("userCancelBtn");

  // Show cancel button only before load (PENDING, ACCEPTED, AT_PICKUP)
  if (cancelBtn) {
    const canCancel = ["PENDING", "ACCEPTED", "ARRIVED_DRIVER"].includes(b.status);
    cancelBtn.style.display = canCancel ? "block" : "none";
  }

  if (b.status === "ARRIVED_DRIVER") {
    if (!b.user_loaded) {
      if (ulBtn) {
        ulBtn.style.display = "block";
        ulBtn.disabled = false;
        ulBtn.innerHTML = "✓ Confirm Cargo Loaded at Pickup";
      }
      if (statusBox) {
        statusBox.classList.remove("d-none", "alert-secondary", "alert-info");
        statusBox.classList.add("alert-warning");
        statusBox.innerHTML = "Driver arrived. Please load the truck and confirm.";
      }
    } else if (!b.driver_loaded) {
      if (ulBtn) ulBtn.style.display = "none";
      if (statusBox) {
        statusBox.classList.remove("d-none", "alert-warning", "alert-secondary");
        statusBox.classList.add("alert-info");
        statusBox.innerHTML = "⏳ Waiting for driver to confirm loading...";
      }
    }
  } else {
    if (ulBtn) ulBtn.style.display = "none";
    if (statusBox) statusBox.classList.add("d-none");
  }

  // Intermediate stop confirm buttons
  renderStopActionButtons(b);

  // Routes
  if (b.to_pickup_geojson || b.to_drop_geojson) {
    showBothRoutes(b.to_pickup_geojson, b.to_drop_geojson || b.route_geojson);
  } else if (b.route_geojson && !routeLayer) {
    showRoute(b.route_geojson);
  }

  // Vehicle marker
  if (b.assigned_vehicle) {
    const db = await fetch("/api/db").then(r => r.json()).catch(() => null);
    if (db && db.vehicles) {
      const v = db.vehicles.find(x => x.id === b.assigned_vehicle);
      const sm = staticMarkersById[b.assigned_vehicle];
      if (sm) { map.removeLayer(sm); delete staticMarkersById[b.assigned_vehicle]; }
      if (v) {
        const latlng = [v.lat, v.lng];
        if (!vehicleMarker) {
          vehicleMarker = L.marker(latlng, {
            icon: L.icon({ iconUrl: "/static/images/truck_icon.png", iconSize: [40, 40] })
          }).addTo(map);
        } else vehicleMarker.setLatLng(latlng);
      }
    }
  }

  // Completed
  if (b.status === "COMPLETED") {
    bookingId = null; bookingData = null;
    localStorage.removeItem("bookingId");
    document.getElementById("bookBtn").disabled = false;
    document.getElementById("estimateBtn").disabled = false;
    document.getElementById("bookingFormCard").style.display = "block";
    document.getElementById("tripSummaryCard").style.display = "none";
    if (vehicleMarker) { map.removeLayer(vehicleMarker); vehicleMarker = null; }
    clearRoutes(); clearMarkers();
    const bookRes = document.getElementById("bookRes");
    bookRes.innerHTML = '<div class="alert alert-success">🎉 Trip delivered successfully!</div>';
    setTimeout(() => { bookRes.innerHTML = ""; }, 6000);
  }
}

function renderStopActionButtons(b) {
  const container = document.getElementById("stopActionsContainer");
  if (!container) return;
  const stops = b.stops || [];
  let html = "";
  stops.forEach((stop, idx) => {
    const atStop = b.status === `AT_STOP_${idx}`;
    if (atStop && !b[`user_stop_${idx}_loaded`]) {
      html += `<button class="btn btn-warning w-100 mb-2 py-2 fw-semibold" id="userStopBtn-${idx}" onclick="confirmStopLoaded(${idx})">
        📦 Confirm Loaded at "${stop.name}" (Stop ${idx + 1})
      </button>`;
    }
  });
  container.innerHTML = html;
}

// ── Helpers ───────────────────────────────────────────────────
function getManualTrucks() {
  const isManual = document.getElementById("manualTrucksCheck").checked;
  if (!isManual) {
    document.getElementById("truckCapacityWarning").classList.add("d-none");
    return null;
  }

  const countLight = parseInt(document.getElementById("countLight").value) || 0;
  const countSmall = parseInt(document.getElementById("countSmall").value) || 0;
  const countBig = parseInt(document.getElementById("countBig").value) || 0;

  if (countLight === 0 && countSmall === 0 && countBig === 0) {
    alert("Please enter at least one truck if selecting manually.");
    return false;
  }

  const weight = parseFloat(document.getElementById("weight").value || 0);
  const totalCapacity = (countLight * 1000) + (countSmall * 3000) + (countBig * 10000);

  const warnEl = document.getElementById("truckCapacityWarning");
  if (totalCapacity < weight) {
    warnEl.classList.remove("d-none");
    return false;
  } else {
    warnEl.classList.add("d-none");
  }

  return { light: countLight, small: countSmall, big: countBig };
}

// ── Fill summary panel ────────────────────────────────────────
function fillUserSummary(b) {
  if (!b) return;
  const km = typeof b.distance_km === "number" ? b.distance_km.toFixed(3) : "-";
  document.getElementById("sumBookingId").innerText = b.id;
  document.getElementById("sumPickup").innerText = b.pickup;
  document.getElementById("sumDrop").innerText = b.drop;
  document.getElementById("sumDistance").innerText = km + " km";
  document.getElementById("sumEta").innerText = (b.eta_mins ? (b.eta_mins.toFixed ? b.eta_mins.toFixed(1) : b.eta_mins) : "-") + " mins";
  document.getElementById("sumCost").innerText = b.cost;
  document.getElementById("sumHaltCharge").innerText = "₹" + (b.halt_charge || 0).toFixed(2);
  // Truck type
  const ttEl = document.getElementById("sumTruckType");
  const ntEl = document.getElementById("sumNumTrucks");

  if (ttEl) {
    if (b.truck_mix && b.truck_mix.length > 0) {
      let mixHtml = "";
      b.truck_mix.forEach(tm => {
        mixHtml += `<span class="truck-badge ${TRUCK_BADGE_CLASS[tm.type] || 'truck-small'} me-1 mb-1 d-inline-block">${tm.count}× ${tm.label}</span>`;
      });
      ttEl.innerHTML = mixHtml;
    } else {
      ttEl.innerHTML = b.truck_type
        ? `<span class="truck-badge ${TRUCK_BADGE_CLASS[b.truck_type] || 'truck-small'}">${TRUCK_LABEL[b.truck_type] || b.truck_type}</span>`
        : "-";
    }
  }
  if (ntEl) {
    ntEl.innerText = b.num_trucks ? `${b.num_trucks} truck(s)` : "-";
  }
  // Stops
  const stopsEl = document.getElementById("sumStops");
  const stopsRow = document.getElementById("sumStopsRow");
  if ((b.stops || []).length > 0) {
    stopsEl.innerText = b.stops.map(s => s.name).join(" → ");
    stopsRow.classList.remove("d-none");
  } else {
    stopsRow.classList.add("d-none");
  }
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  map = L.map("map").setView([19.1326, 72.9132], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

  // Load vehicles
  const db = await fetch("/api/db").then(r => r.json()).catch(() => ({ vehicles: [] }));
  (db.vehicles || []).forEach(v => {
    const m = L.marker([v.lat, v.lng], {
      icon: L.icon({ iconUrl: "/static/images/truck_icon.png", iconSize: [40, 40] })
    }).addTo(map).bindPopup(v.name || v.id);
    staticMarkersById[v.id] = m;
  });

  // Load locations
  const locs = await fetch(`${API}/locations`).then(r => r.json());
  const pickupSel = document.getElementById("pickup");
  const dropSel = document.getElementById("drop");
  locs.forEach(l => {
    locationsByName[l.name] = [l.lat, l.lng];
    [pickupSel, dropSel].forEach(sel => {
      const o = document.createElement("option");
      o.value = l.name; o.textContent = l.name;
      sel.appendChild(o);
    });
  });

  // Prevent same pickup/drop
  function refreshDropOptions() {
    const pv = pickupSel.value, prev = dropSel.value;
    dropSel.innerHTML = "";
    Object.keys(locationsByName).forEach(name => {
      if (name === pv) return;
      const o = document.createElement("option"); o.value = name; o.textContent = name;
      dropSel.appendChild(o);
    });
    if (prev && prev !== pv) dropSel.value = prev;
  }
  function refreshPickupOptions() {
    const dv = dropSel.value, prev = pickupSel.value;
    pickupSel.innerHTML = "";
    Object.keys(locationsByName).forEach(name => {
      if (name === dv) return;
      const o = document.createElement("option"); o.value = name; o.textContent = name;
      pickupSel.appendChild(o);
    });
    if (prev && prev !== dv) pickupSel.value = prev;
  }
  pickupSel.addEventListener("change", refreshDropOptions);
  dropSel.addEventListener("change", refreshPickupOptions);
  refreshDropOptions();

  // Hide estimate if inputs change
  const hideEstimate = () => document.getElementById("estBoxCard").classList.add("d-none");
  pickupSel.addEventListener("change", hideEstimate);
  dropSel.addEventListener("change", hideEstimate);
  document.getElementById("weight").addEventListener("input", () => {
    hideEstimate();
    // Validate live if manual is checked
    if (document.getElementById("manualTrucksCheck").checked) getManualTrucks();
  });

  document.getElementById("manualTrucksCheck").addEventListener("change", (e) => {
    document.getElementById("manualTrucksDiv").classList.toggle("d-none", !e.target.checked);
    hideEstimate();
    if (e.target.checked) getManualTrucks();
  });
  document.getElementById("countLight").addEventListener("input", hideEstimate);
  document.getElementById("countSmall").addEventListener("input", hideEstimate);
  document.getElementById("countBig").addEventListener("input", hideEstimate);
  document.getElementById("countLight").addEventListener("change", getManualTrucks);
  document.getElementById("countSmall").addEventListener("change", getManualTrucks);
  document.getElementById("countBig").addEventListener("change", getManualTrucks);

  // Weight badge live update
  document.getElementById("weight").addEventListener("input", updateTruckBadge);
  updateTruckBadge();

  // Buttons
  document.getElementById("estimateBtn").onclick = estimate;
  document.getElementById("bookBtn").onclick = book;
  document.getElementById("userLoadedBtn").onclick = confirmUserLoaded;

  // Poll
  setInterval(pollBooking, 2000);

  // Session restore
  const storedId = localStorage.getItem("bookingId");
  if (storedId) {
    bookingId = storedId;
    document.getElementById("bookBtn").disabled = true;
    document.getElementById("estimateBtn").disabled = true;
    document.getElementById("bookingFormCard").style.display = "none";
    document.getElementById("tripSummaryCard").style.display = "block";
    try {
      const j = await fetch(`${API}/booking/${bookingId}`).then(r => r.json());
      if (!j.error) {
        bookingData = j.booking;
        fillUserSummary(j.booking);
        const b = j.booking;
        const pLL = [b.pickup_coords[0], b.pickup_coords[1]];
        const dLL = [b.drop_coords[0], b.drop_coords[1]];
        clearMarkers();
        pickupMarker = L.marker(pLL).addTo(map).bindPopup("Pickup");
        dropMarker = L.marker(dLL).addTo(map).bindPopup("Drop");
        addStopMarkers(b.stops);
        if (b.to_pickup_geojson || b.to_drop_geojson) {
          showBothRoutes(b.to_pickup_geojson, b.to_drop_geojson || b.route_geojson);
        } else if (b.route_geojson) showRoute(b.route_geojson);
      } else {
        localStorage.removeItem("bookingId");
        bookingId = null;
        document.getElementById("bookBtn").disabled = false;
        document.getElementById("estimateBtn").disabled = false;
        document.getElementById("bookingFormCard").style.display = "block";
        document.getElementById("tripSummaryCard").style.display = "none";
      }
    } catch (e) { /* ignore */ }
  }
}

window.onload = init;
