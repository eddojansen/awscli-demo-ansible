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
  routeView: $('route-view'),
  routeChoices: $('route-choices'),
  limits: $('limits'),
  noRoute: $('no-route'),
  altNote: $('alt-note'),
  map: $('map'),
};

let currentLocation = null; // {lat, lon} when origin is "My location"
let map = null;
let routeLayer = null;
let focusMarker = null;
let currentResult = null;

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

class RouteError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function truckOptions(dims, opts) {
  return {
    weight: round(dims.weight, 2),
    height: round(dims.height, 2),
    width: round(dims.width, 2),
    length: round(dims.length, 2),
    hazmat: opts.hazmat,
    use_tolls: opts.avoidTolls ? 0 : 0.5,
    use_highways: opts.avoidHighways ? 0 : 1,
  };
}

async function valhallaRoute(from, to, costing, costingOptions, system, alternates = 0) {
  const body = {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing,
    costing_options: { [costing]: costingOptions },
    units: system === 'metric' ? 'kilometers' : 'miles',
    language: navigator.language || 'en-US',
  };
  if (alternates) body.alternates = alternates;
  const res = await fetch(VALHALLA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.trip) {
    if (data.error_code === 442 || data.error_code === 443) {
      throw new RouteError('No route found that fits these dimensions.', 'no_route');
    }
    if (data.error_code === 171) {
      throw new RouteError('No road suitable for this vehicle near the start or destination.', 'no_road');
    }
    throw new RouteError(data.error ? `Routing failed: ${data.error}` : `Routing failed (${res.status}).`);
  }
  return [data.trip, ...(data.alternates || []).map((a) => a.trip)];
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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const DIM_LABEL = { height: 'height', width: 'width', length: 'length', weight: 'weight' };

function formatDim(dim, metricValue, system) {
  const v = toDisplay(dim, metricValue, system);
  if (dim === 'weight') return system === 'metric' ? `${round(metricValue, 1)} t` : `${v.toLocaleString()} lb`;
  return system === 'metric' ? `${v} m` : `${v} ft`;
}

// A fit within this margin is worth double-checking against the signs.
function isTight(dim, margin, limit) {
  return dim === 'weight' ? margin < limit * 0.1 : margin < 0.3;
}

const ACCESS_TEXT = {
  destination: 'trucks only to reach a destination on it',
  delivery: 'trucks only for deliveries',
  private: 'trucks need permission',
  permit: 'trucks need a permit',
  agricultural: 'agricultural trucks only',
};

function renderRouteChoices(result) {
  els.routeChoices.replaceChildren();
  els.routeChoices.hidden = result.trips.length < 2;
  const first = result.trips[0].summary.time;
  result.trips.forEach((trip, i) => {
    const btn = el('button', 'route-choice');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(i === result.selected));
    btn.append(el('span', 'name', i === 0 ? 'Recommended' : `Alternative ${i}`));
    btn.append(el('span', 'time', formatDuration(trip.summary.time)));
    const extra = trip.summary.time - first;
    btn.append(el('span', 'meta', `${formatDistance(trip.summary.length, result.system)}${i && extra >= 60 ? ` · +${formatDuration(extra)}` : ''}`));
    btn.addEventListener('click', () => selectRoute(result, i));
    els.routeChoices.append(btn);
  });
}

function renderResult(result) {
  const { from, to, system } = result;
  const trip = result.trips[result.selected];
  const s = trip.summary;

  els.summary.replaceChildren(
    el('div', 'big', `${formatDuration(s.time)} · ${formatDistance(s.length, system)}`),
    el('div', 'sub', `${from.name} → ${to.name}`),
  );

  const flags = [];
  if (s.has_toll) flags.push('Toll roads');
  if (s.has_ferry) flags.push('Ferry');
  if (s.has_time_restrictions) flags.push('Time-restricted roads');
  if (flags.length) {
    const ul = el('ul', 'flags');
    for (const f of flags) ul.append(el('li', null, f));
    els.summary.append(ul);
  }

  renderRouteChoices(result);

  els.maneuvers.replaceChildren();
  for (const leg of trip.legs) {
    for (const m of leg.maneuvers) {
      const li = el('li', null, m.instruction);
      if (m.length > 0) li.append(el('div', 'dist', formatDistance(m.length, system)));
      els.maneuvers.append(li);
    }
  }

  els.appleMaps.href = appleMapsUrl(from, to);
  els.altNote.hidden = result.selected === 0;
  els.noRoute.hidden = true;
  els.routeView.hidden = false;
  els.result.hidden = false;
  drawMap(result);
  renderLimits(result);
}

function limitItem(text, at, className) {
  const li = el('li', className);
  const btn = el('button', 'link', text);
  btn.type = 'button';
  btn.addEventListener('click', () => showOnMap(at, text));
  li.append(btn);
  return li;
}

function violationText(v, system) {
  if (v.dim === 'hgv') return `${v.name}: no trucks`;
  if (v.dim === 'hazmat') return `${v.name}: no hazardous materials`;
  return `${v.name}: max ${DIM_LABEL[v.dim]} ${formatDim(v.dim, v.limit, system)}`;
}

function renderAvoided(container, list, dims, system, heading) {
  if (!list.length) return;
  container.append(el('h3', null, heading));
  const ul = el('ul', 'limits');
  for (const v of list) {
    const you = v.limit != null ? ` (you: ${formatDim(v.dim, dims[v.dim], system)})` : '';
    ul.append(limitItem(violationText(v, system) + you, v.at, 'bad'));
  }
  container.append(ul);
}

function renderLimits(result) {
  const box = els.limits;
  const d = result.details[result.selected];
  box.replaceChildren(el('h2', null, 'Road limits on this route'));
  if (!result.dims) {
    box.append(el('p', 'note', 'Search again to see road limits.'));
    return;
  }
  if (!d) {
    box.append(el('p', 'note', 'Checking road limits…'));
    return;
  }
  if (d.error) {
    box.append(el('p', 'error', `Couldn't load road limits: ${d.error}`));
    return;
  }

  const { system, dims } = result;
  const ul = el('ul', 'limits');
  for (const dim of DIM_FIELDS) {
    const t = d.tightest[dim];
    if (!t) {
      ul.append(el('li', 'none', `No ${DIM_LABEL[dim]} limits mapped`));
      continue;
    }
    const tight = isTight(dim, t.margin, t.limit);
    const text = `Lowest ${DIM_LABEL[dim]} limit: ${formatDim(dim, t.limit, system)} at ${t.name}. `
      + `You: ${formatDim(dim, dims[dim], system)}${tight ? ', a close fit' : ''}.`;
    ul.append(limitItem(text, t.at, tight ? 'warn' : 'ok'));
  }
  box.append(ul);

  if (d.conditional.length) {
    box.append(el('h3', null, 'Roads with truck access rules'));
    const cl = el('ul', 'limits');
    for (const c of d.conditional) cl.append(limitItem(`${c.name}: ${ACCESS_TEXT[c.value] || c.value}`, c.at, 'warn'));
    box.append(cl);
  }

  if (d.avoided) {
    const extra = result.trips[result.selected].summary.time - d.carTime;
    renderAvoided(box, d.avoided, dims, system, 'Avoided because of your vehicle');
    if (d.avoided.length && extra >= 60) {
      box.append(el('p', 'note', `This route takes ${formatDuration(extra)} longer than a car's route, which uses the roads above.`));
    } else if (!d.avoided.length) {
      box.append(el('p', 'note', 'No mapped limit on a car\'s route stops your vehicle, so its size isn\'t forcing a detour here.'));
    }
  }

  box.append(el('p', 'note', `Checked ${d.roadCount.toLocaleString()} road segments in OpenStreetMap. Limits that nobody has mapped, and some single-point barriers, are not listed, so always obey the signs.`));
}

async function computeDetails(result, i) {
  const trip = result.trips[i];
  const roads = await Restrictions.roadsOf(trip, 'truck', { truck: result.truckOptions }, decodePolyline6);
  const summary = Restrictions.summarize(roads, result.dims);
  const pick = (r) => ({ name: r.name, at: r.at });
  const details = {
    roadCount: summary.roadCount,
    tightest: Object.fromEntries(Object.entries(summary.tightest)
      .map(([dim, t]) => [dim, { limit: t.limit, margin: t.margin, ...pick(t.road) }])),
    conditional: summary.conditional.map((c) => ({ value: c.value, ...pick(c.road) })),
  };
  const car = await carReference(result);
  if (car) {
    const used = new Set(roads.map((r) => r.id));
    details.avoided = Restrictions.avoided(car.roads, result.dims, result.hazmat, used)
      .map((v) => ({ dim: v.dim, limit: v.limit, value: v.value, ...pick(v.road) }));
    details.carTime = car.time;
  }
  return details;
}

// The car route shows which roads a vehicle without size limits would use.
const carCache = new WeakMap();
async function carReference(result) {
  if (!carCache.has(result)) {
    carCache.set(result, (async () => {
      try {
        const [carTrip] = await valhallaRoute(result.from, result.to, 'auto', {}, result.system);
        const roads = await Restrictions.roadsOf(carTrip, 'auto', {}, decodePolyline6);
        return { roads, time: carTrip.summary.time };
      } catch (_) {
        return null;
      }
    })());
  }
  return carCache.get(result);
}

async function loadDetails(result, i) {
  if (!result.dims || result.details[i]) return;
  try {
    result.details[i] = await computeDetails(result, i);
  } catch (e) {
    result.details[i] = { error: e instanceof TypeError ? 'no connection' : e.message, transient: true };
  }
  if (currentResult === result) {
    if (result.selected === i) renderLimits(result);
    persistResult(result);
  }
  if (result.details[i].transient) delete result.details[i];
}

function selectRoute(result, i) {
  result.selected = i;
  renderResult(result);
  persistResult(result);
  loadDetails(result, i);
}

function persistResult(result) {
  const details = Object.fromEntries(Object.entries(result.details).filter(([, d]) => !d.error));
  saveState({ lastResult: { ...result, details } });
}

async function explainNoRoute(result) {
  els.result.hidden = false;
  els.routeView.hidden = true;
  els.noRoute.hidden = false;
  const box = els.noRoute;
  box.replaceChildren(
    el('h2', null, 'No route fits this vehicle'),
    el('p', 'note', 'Checking which roads block it…'),
  );
  if (routeLayer) routeLayer.remove();

  const car = await carReference(result);
  if (currentResult !== result) return;
  box.replaceChildren(el('h2', null, 'No route fits this vehicle'));
  if (!car) {
    box.append(el('p', 'note', 'Couldn\'t check the roads. Try a different destination or check the values.'));
    return;
  }
  const blocking = Restrictions.avoided(car.roads, result.dims, result.hazmat)
    .map((v) => ({ dim: v.dim, limit: v.limit, value: v.value, name: v.road.name, at: v.road.at }));
  if (blocking.length) {
    renderAvoided(box, blocking, result.dims, result.system, 'A car can make this trip, but its route has these limits:');
    box.append(el('p', 'note', 'Often the limit is close to the start or destination. Try an address nearby on a bigger road.'));
  } else {
    box.append(el('p', 'note', 'No mapped size limits on a car\'s route stop this vehicle. The block may be a turn rule or an access rule near the start or destination.'));
  }
}

function drawMap(result) {
  if (typeof L === 'undefined') return;
  if (!map) {
    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  }
  if (routeLayer) routeLayer.remove();
  const { from, to } = result;
  const layers = [];
  result.trips.forEach((trip, i) => {
    if (i === result.selected) return;
    const line = L.polyline(trip.legs.flatMap((leg) => decodePolyline6(leg.shape)), { color: '#8e8e93', weight: 5, opacity: 0.8 });
    line.on('click', () => selectRoute(result, i));
    layers.push(line);
  });
  const selected = result.trips[result.selected];
  layers.push(L.polyline(selected.legs.flatMap((leg) => decodePolyline6(leg.shape)), { color: '#0b5cad', weight: 6, opacity: 0.9 }));
  layers.push(
    L.circleMarker([from.lat, from.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2e7d32', fillOpacity: 1 }),
    L.circleMarker([to.lat, to.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#c62828', fillOpacity: 1 }),
  );
  routeLayer = L.featureGroup(layers).addTo(map);
  map.invalidateSize();
  map.fitBounds(routeLayer.getBounds(), { padding: [24, 24] });
}

function showOnMap(at, text) {
  if (!map || !at) return;
  if (els.routeView.hidden) return;
  if (focusMarker) focusMarker.remove();
  focusMarker = L.circleMarker(at, { radius: 10, color: '#fff', weight: 3, fillColor: '#ff9500', fillOpacity: 1 })
    .bindPopup(text).addTo(map);
  map.setView(at, 16);
  focusMarker.openPopup();
  els.map.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    const result = {
      from, to, system, dims: { ...dims }, hazmat: opts.hazmat,
      truckOptions: truckOptions(dims, opts), trips: [], selected: 0, details: {},
    };
    currentResult = result;
    try {
      result.trips = await valhallaRoute(from, to, 'truck', result.truckOptions, system, 2);
    } catch (e) {
      if (e.code !== 'no_route') throw e;
      els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      explainNoRoute(result);
      return;
    }
    renderResult(result);
    persistResult(result);
    els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    loadDetails(result, 0);
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
  if (state.lastResult) {
    const r = state.lastResult;
    // Results saved before alternatives existed hold a single `trip`.
    if (!r.trips) Object.assign(r, { trips: [r.trip], selected: 0, details: {} });
    currentResult = r;
    renderResult(r);
    if (navigator.onLine) loadDetails(r, r.selected);
  }

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
