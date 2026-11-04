'use strict';

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const STORAGE_KEY = 'trailer-route:v1';

const KG_PER_LB = 0.45359237;
const M_PER_FT = 0.3048;

// Metric values: tonnes and metres. Mirrors config/trailer_config.json plus a caravan preset.
const PRESETS = {
  caravan: { label: 'Car + caravan', weight: 3.5, height: 2.7, width: 2.5, length: 12 },
  standard_semi: { label: 'Standard semi-trailer', weight: 25, height: 4.0, width: 2.4, length: 13.6 },
  double_trailer: { label: 'Double trailer', weight: 35, height: 4.2, width: 2.5, length: 18 },
  oversized_load: { label: 'Oversized load', weight: 45, height: 4.5, width: 3.0, length: 20 },
  custom: { label: 'Custom' },
};
const DIM_FIELDS = ['weight', 'height', 'width', 'length'];

const $ = (id) => document.getElementById(id);
const form = $('route-form');
const els = {
  origin: $('origin'),
  destination: $('destination'),
  preset: $('preset'),
  submit: $('submit'),
  error: $('form-error'),
  result: $('result'),
  summary: $('summary'),
  maneuvers: $('maneuvers'),
  appleMaps: $('apple-maps'),
  useLocation: $('use-location'),
  netStatus: $('net-status'),
};

let currentLocation = null; // {lat, lon} when origin is "My location"
let map = null;
let routeLayer = null;

function units() {
  return form.elements.units.value;
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// Display conversion between metric (t, m) and imperial (lb, ft).
function toDisplay(field, metricValue, system) {
  if (system === 'metric') return round(metricValue, 2);
  return field === 'weight'
    ? Math.round((metricValue * 1000) / KG_PER_LB)
    : round(metricValue / M_PER_FT, 1);
}

function toMetric(field, displayValue, system) {
  if (system === 'metric') return displayValue;
  return field === 'weight' ? (displayValue * KG_PER_LB) / 1000 : displayValue * M_PER_FT;
}

function updateUnitLabels() {
  const metric = units() === 'metric';
  document.querySelectorAll('.unit').forEach((el) => {
    el.textContent = el.dataset.unit === 'weight' ? (metric ? 't' : 'lb') : (metric ? 'm' : 'ft');
  });
}

// Unrounded metric values; the inputs show them rounded, so toggling units doesn't drift.
const metricDims = {};

function showDims() {
  for (const f of DIM_FIELDS) {
    $(f).value = Number.isFinite(metricDims[f]) ? toDisplay(f, metricDims[f], units()) : '';
  }
}

function applyPreset(key) {
  const p = PRESETS[key];
  if (!p || key === 'custom') return;
  for (const f of DIM_FIELDS) metricDims[f] = p[f];
  showDims();
}

function readDimensions() {
  const dims = {};
  for (const f of DIM_FIELDS) {
    if (!(parseFloat($(f).value) > 0)) throw new Error(`Enter a positive ${f}.`);
    dims[f] = metricDims[f];
  }
  return dims;
}

function saveState(extra = {}) {
  const prev = loadState();
  const state = {
    ...prev,
    origin: els.origin.value,
    destination: els.destination.value,
    preset: els.preset.value,
    units: units(),
    dims: { ...metricDims },
    avoidTolls: form.elements.avoidTolls.checked,
    avoidHighways: form.elements.avoidHighways.checked,
    hazmat: form.elements.hazmat.checked,
    ...extra,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) { /* storage full or disabled */ }
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (_) {
    return {};
  }
}

async function geocode(query) {
  const coords = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) return { lat: +coords[1], lon: +coords[2], name: query.trim() };

  const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'Accept-Language': navigator.language || 'en' } });
  if (!res.ok) throw new Error(`Address search failed (${res.status}).`);
  const [hit] = await res.json();
  if (!hit) throw new Error(`Couldn't find "${query}".`);
  return { lat: +hit.lat, lon: +hit.lon, name: hit.display_name.split(', ').slice(0, 2).join(', ') };
}

async function route(from, to, dims, opts) {
  const body = {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: 'truck',
    costing_options: {
      truck: {
        weight: round(dims.weight, 2),
        height: round(dims.height, 2),
        width: round(dims.width, 2),
        length: round(dims.length, 2),
        hazmat: opts.hazmat,
        use_tolls: opts.avoidTolls ? 0 : 0.5,
        use_highways: opts.avoidHighways ? 0 : 1,
      },
    },
    units: opts.units === 'metric' ? 'kilometers' : 'miles',
    language: navigator.language || 'en-US',
  };
  const res = await fetch(VALHALLA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.trip) {
    if (data.error_code === 442 || data.error_code === 443) {
      throw new Error('No route found that fits these dimensions. Try a different destination or check the values.');
    }
    if (data.error_code === 171) {
      throw new Error('No road suitable for this vehicle near the start or destination.');
    }
    throw new Error(data.error ? `Routing failed: ${data.error}` : `Routing failed (${res.status}).`);
  }
  return data.trip;
}

// Valhalla encodes shapes as polylines with 6-digit precision.
function decodePolyline6(str) {
  const coords = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, byte;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lon += delta;
    }
    coords.push([lat / 1e6, lon / 1e6]);
  }
  return coords;
}

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${String(mins % 60).padStart(2, '0')} min`;
}

function formatDistance(value, system) {
  if (system === 'metric' && value < 1) return `${Math.round(value * 100) * 10} m`;
  if (system !== 'metric' && value < 0.2) return `${Math.round((value * 5280) / 10) * 10} ft`;
  const unit = system === 'metric' ? 'km' : 'mi';
  return `${value < 10 ? round(value, 1) : Math.round(value)} ${unit}`;
}

function appleMapsUrl(from, to) {
  const params = new URLSearchParams({
    saddr: `${from.lat},${from.lon}`,
    daddr: `${to.lat},${to.lon}`,
    dirflg: 'd',
  });
  return `https://maps.apple.com/?${params}`;
}

function renderResult(result) {
  const { trip, from, to, system } = result;
  const s = trip.summary;

  els.summary.replaceChildren();
  const big = document.createElement('div');
  big.className = 'big';
  big.textContent = `${formatDuration(s.time)} · ${formatDistance(s.length, system)}`;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `${from.name} → ${to.name}`;
  els.summary.append(big, sub);

  const flags = [];
  if (s.has_toll) flags.push('Toll roads');
  if (s.has_ferry) flags.push('Ferry');
  if (s.has_time_restrictions) flags.push('Time-restricted roads');
  if (flags.length) {
    const ul = document.createElement('ul');
    ul.className = 'flags';
    for (const f of flags) {
      const li = document.createElement('li');
      li.textContent = f;
      ul.append(li);
    }
    els.summary.append(ul);
  }

  els.maneuvers.replaceChildren();
  for (const leg of trip.legs) {
    for (const m of leg.maneuvers) {
      const li = document.createElement('li');
      li.textContent = m.instruction;
      if (m.length > 0) {
        const d = document.createElement('div');
        d.className = 'dist';
        d.textContent = formatDistance(m.length, system);
        li.append(d);
      }
      els.maneuvers.append(li);
    }
  }

  els.appleMaps.href = appleMapsUrl(from, to);
  els.result.hidden = false;
  drawMap(trip, from, to);
}

function drawMap(trip, from, to) {
  if (typeof L === 'undefined') return;
  if (!map) {
    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  }
  if (routeLayer) routeLayer.remove();
  const line = trip.legs.flatMap((leg) => decodePolyline6(leg.shape));
  routeLayer = L.featureGroup([
    L.polyline(line, { color: '#0b5cad', weight: 6, opacity: 0.85 }),
    L.circleMarker([from.lat, from.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2e7d32', fillOpacity: 1 }),
    L.circleMarker([to.lat, to.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#c62828', fillOpacity: 1 }),
  ]).addTo(map);
  map.invalidateSize();
  map.fitBounds(routeLayer.getBounds(), { padding: [24, 24] });
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = !msg;
}

async function onSubmit(event) {
  event.preventDefault();
  showError('');

  const originText = els.origin.value.trim();
  const destText = els.destination.value.trim();
  if (!originText || !destText) return showError('Enter both a start and a destination.');

  let dims;
  try {
    dims = readDimensions();
  } catch (e) {
    return showError(e.message);
  }

  const system = units();
  const opts = {
    units: system,
    avoidTolls: form.elements.avoidTolls.checked,
    avoidHighways: form.elements.avoidHighways.checked,
    hazmat: form.elements.hazmat.checked,
  };

  els.submit.disabled = true;
  els.submit.textContent = 'Searching…';
  saveState();
  try {
    const from = currentLocation && originText === 'My location'
      ? { ...currentLocation, name: 'My location' }
      : await geocode(originText);
    const to = await geocode(destText);
    const trip = await route(from, to, dims, opts);
    const result = { trip, from, to, system };
    renderResult(result);
    saveState({ lastResult: result });
    els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    showError(e instanceof TypeError ? "Can't reach the routing service. Check your connection." : e.message);
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = 'Find route';
  }
}

function onUseLocation() {
  if (!navigator.geolocation) return showError('Location is not available on this device.');
  els.useLocation.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      els.origin.value = 'My location';
      els.useLocation.disabled = false;
      showError('');
    },
    (err) => {
      els.useLocation.disabled = false;
      showError(err.code === err.PERMISSION_DENIED
        ? 'Location permission denied. Type a start address instead.'
        : "Couldn't get your location.");
    },
    { enableHighAccuracy: true, timeout: 15000 },
  );
}

function updateNetStatus() {
  els.netStatus.hidden = navigator.onLine;
}

function init() {
  for (const [key, p] of Object.entries(PRESETS)) {
    els.preset.append(new Option(p.label, key));
  }

  const state = loadState();
  if (state.units) form.elements.units.value = state.units;
  updateUnitLabels();
  els.preset.value = state.preset && PRESETS[state.preset] ? state.preset : 'standard_semi';
  if (state.dims) {
    for (const f of DIM_FIELDS) metricDims[f] = state.dims[f];
    showDims();
  } else {
    applyPreset(els.preset.value);
  }
  els.origin.value = state.origin === 'My location' ? '' : state.origin || '';
  els.destination.value = state.destination || '';
  form.elements.avoidTolls.checked = !!state.avoidTolls;
  form.elements.avoidHighways.checked = !!state.avoidHighways;
  form.elements.hazmat.checked = !!state.hazmat;
  if (state.lastResult) renderResult(state.lastResult);

  els.preset.addEventListener('change', () => applyPreset(els.preset.value));
  for (const radio of form.elements.units) {
    radio.addEventListener('change', () => {
      showDims();
      updateUnitLabels();
    });
  }
  for (const f of DIM_FIELDS) {
    $(f).addEventListener('input', () => {
      els.preset.value = 'custom';
      metricDims[f] = toMetric(f, parseFloat($(f).value), units());
    });
  }
  els.origin.addEventListener('input', () => { currentLocation = null; });
  els.useLocation.addEventListener('click', onUseLocation);
  form.addEventListener('submit', onSubmit);

  window.addEventListener('online', updateNetStatus);
  window.addEventListener('offline', updateNetStatus);
  updateNetStatus();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
