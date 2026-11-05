'use strict';

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const STORAGE_KEY = 'trailer-route:v1';

const KG_PER_LB = 0.45359237;
const M_PER_FT = 0.3048;
const KM_PER_MI = 1.609344;

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
  verdict: $('verdict'),
  routeDetails: $('route-details'),
  routeChoices: $('route-choices'),
  limits: $('limits'),
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

const SAVED_PREFIX = 'v:';

// A saved vehicle ("v:<id>") or a built-in preset; null for "Custom".
function vehicleFor(key) {
  if (key && key.startsWith(SAVED_PREFIX)) return Vehicles.get(key.slice(SAVED_PREFIX.length));
  return key !== 'custom' && PRESETS[key] ? PRESETS[key] : null;
}

function fillVehicleSelect(selected) {
  const saved = Vehicles.list();
  const presets = Object.entries(PRESETS).filter(([key]) => key !== 'custom');
  els.preset.replaceChildren();
  if (saved.length) {
    const mine = document.createElement('optgroup');
    mine.label = 'My vehicles';
    for (const v of saved) mine.append(new Option(v.name, SAVED_PREFIX + v.id));
    const builtIn = document.createElement('optgroup');
    builtIn.label = 'Presets';
    for (const [key, p] of presets) builtIn.append(new Option(p.label, key));
    els.preset.append(mine, builtIn);
  } else {
    for (const [key, p] of presets) els.preset.append(new Option(p.label, key));
  }
  els.preset.append(new Option('Custom', 'custom'));
  els.preset.value = vehicleFor(selected) ? selected : 'custom';
}

function applyPreset(key) {
  const p = vehicleFor(key);
  if (!p) return;
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

// Where along a route something is, in words.
function kmText(km, system) {
  return formatDistance(system === 'metric' ? km : km / KM_PER_MI, system);
}

function whereText(km, totalKm, system) {
  if (km == null || !totalKm) return '';
  const toEnd = totalKm - km;
  if (toEnd < km) return toEnd < 0.3 ? 'at your destination' : `${kmText(toEnd, system)} before your destination`;
  return km < 0.3 ? 'at the start' : `${kmText(km, system)} after the start`;
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function tripLine(trip) {
  return trip.legs.flatMap((leg) => decodePolyline6(leg.shape));
}

// The router snaps start and destination to the nearest road this vehicle may use.
// If that road is far away, the route doesn't really get you there.
const GAP_KM = 0.3;
function gaps(result, trip) {
  const line = tripLine(trip);
  const out = [];
  const startGap = distanceKm([result.from.lat, result.from.lon], line[0]);
  const endGap = distanceKm([result.to.lat, result.to.lon], line[line.length - 1]);
  if (startGap > GAP_KM) {
    out.push({ text: `First ${kmText(startGap, result.system)} from your start: no road this vehicle may use. The route only begins at the marked point.`, at: line[0] });
  }
  if (endGap > GAP_KM) {
    out.push({ text: `Last ${kmText(endGap, result.system)} to your destination: no road this vehicle may use. The route stops at the marked point.`, at: line[line.length - 1] });
  }
  return out;
}

function violationText(v, system) {
  if (v.dim === 'hgv') return `${v.name}: no trucks allowed`;
  if (v.dim === 'hazmat') return `${v.name}: no hazardous materials`;
  return `${v.name}: max ${DIM_LABEL[v.dim]} ${formatDim(v.dim, v.limit, system)}`;
}

function blockText(v, dims, system, totalKm) {
  const you = v.limit != null ? ` (you: ${formatDim(v.dim, dims[v.dim], system)})` : '';
  const where = whereText(v.km, totalKm, system);
  return `${violationText(v, system)}${you}${where ? `, ${where}` : ''}`;
}

function spareText(dim, t, system) {
  if (t.margin < 0.005) return `Exactly at the ${formatDim(dim, t.limit, system)} ${DIM_LABEL[dim]} limit`;
  return `Only ${formatDim(dim, t.margin, system)} spare under the ${formatDim(dim, t.limit, system)} ${DIM_LABEL[dim]} limit`;
}

// good: nothing to worry about; check: drivable but needs attention; bad: part of the trip isn't allowed.
function verdict(result, i) {
  const trip = result.trips[i];
  const d = result.details[i];
  const { system, dims } = result;
  const bad = gaps(result, trip);
  const check = [];

  if (d && !d.error) {
    for (const v of d.problems || []) bad.push({ text: blockText(v, dims, system, d.totalKm), at: v.at });
    for (const dim of DIM_FIELDS) {
      const t = d.tightest[dim];
      if (t && t.margin >= 0 && isTight(dim, t.margin, t.limit)) {
        const where = whereText(t.km, d.totalKm, system);
        check.push({ text: `${spareText(dim, t, system)} at ${t.name}${where ? `, ${where}` : ''}`, at: t.at });
      }
    }
    for (const c of d.conditional) {
      const where = whereText(c.km, d.totalKm, system);
      check.push({ text: `${c.name}: ${ACCESS_TEXT[c.value] || c.value}${where ? `, ${where}` : ''}`, at: c.at });
    }
    if (d.carTime && trip.summary.time > d.carTime * 1.5 && trip.summary.time - d.carTime > 15 * 60) {
      check.push({ text: `Long way round: ${formatDuration(trip.summary.time - d.carTime)} longer than a car, because closer roads don't fit your vehicle.` });
    }
  } else if (d && d.error) {
    check.push({ text: `Couldn't check road limits (${d.error}).` });
  }
  if (trip.summary.has_ferry) check.push({ text: 'Includes a ferry. Check that it takes your vehicle\'s size and weight.' });
  if (trip.summary.has_time_restrictions) check.push({ text: 'Some roads on this route are closed to trucks at certain times.' });

  const level = bad.length ? 'bad' : !d ? 'pending' : check.length ? 'check' : 'good';
  return { level, bad, check };
}

const LEVEL_CHIP = { good: '✓ Good fit', check: '! Check', bad: '✕ Problem', pending: 'Checking…' };

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
    const level = verdict(result, i).level;
    btn.append(el('span', `chip ${level}`, LEVEL_CHIP[level]));
    btn.addEventListener('click', () => selectRoute(result, i));
    els.routeChoices.append(btn);
  });
}

function issueList(items, className) {
  const ul = el('ul', 'limits');
  for (const it of items) ul.append(it.at ? limitItem(it.text, it.at, className) : el('li', className, it.text));
  return ul;
}

const NEXT_STEPS = 'What you can do: set the destination on a bigger road nearby, double-check your vehicle\'s sizes, or ask the road authority about a permit for this trip.';

function renderVerdict(result) {
  const box = els.verdict;
  const all = result.trips.map((_, i) => verdict(result, i));
  const sel = all[result.selected];
  const goodIndex = all.findIndex((v) => v.level === 'good');
  const anyPending = all.some((v) => v.level === 'pending');
  const allBad = all.every((v) => v.level === 'bad');

  let level = sel.level;
  let title;
  let sub = '';
  if (sel.level === 'good') {
    title = 'Good route for your vehicle';
    sub = 'Every mapped limit on this route clears your vehicle with room to spare.';
  } else if (sel.level === 'pending') {
    title = 'Checking whether this route fits…';
  } else if (goodIndex !== -1) {
    title = sel.level === 'bad' ? 'Part of this route isn\'t allowed for your vehicle' : 'Possible, but check before you go';
  } else if (anyPending) {
    title = sel.level === 'bad' ? 'Part of this route isn\'t allowed for your vehicle' : 'Possible, but check before you go';
    sub = 'Still checking the other routes…';
  } else if (allBad) {
    title = 'No safe route to this destination';
    sub = result.trips.length > 1 ? 'None of the routes found is fully allowed for your vehicle. On this one, these parts are the problem:' : 'Part of the only route found isn\'t allowed for your vehicle:';
  } else {
    level = 'check';
    title = 'No really good route to this destination';
    sub = 'This is the best option found, but these parts need attention:';
  }

  box.className = `verdict ${level}`;
  box.replaceChildren(el('p', 'verdict-title', title));
  if (sub) box.append(el('p', 'verdict-sub', sub));
  if (sel.bad.length) box.append(issueList(sel.bad, 'bad'));
  if (sel.check.length) box.append(issueList(sel.check, 'warn'));
  if (goodIndex !== -1 && goodIndex !== result.selected) {
    const btn = el('button', 'primary secondary', `Switch to ${goodIndex === 0 ? 'the recommended route' : `Alternative ${goodIndex}`}: no issues found`);
    btn.type = 'button';
    btn.addEventListener('click', () => selectRoute(result, goodIndex));
    box.append(btn);
  }
  if (!anyPending && goodIndex === -1 && sel.level === 'bad') box.append(el('p', 'verdict-sub', NEXT_STEPS));
}

function setMode(routeFound) {
  els.summary.hidden = !routeFound;
  els.routeDetails.hidden = !routeFound;
  if (!routeFound) els.routeChoices.hidden = true;
  els.result.hidden = false;
}

function renderResult(result) {
  const { from, to, system } = result;
  const trip = result.trips[result.selected];
  const s = trip.summary;
  setMode(true);

  els.summary.replaceChildren(
    el('div', 'big', `${formatDuration(s.time)} · ${formatDistance(s.length, system)}`),
    el('div', 'sub', `${from.name} → ${to.name}`),
  );

  renderRouteChoices(result);
  renderVerdict(result);

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
    const cls = t.margin < 0 ? 'bad' : isTight(dim, t.margin, t.limit) ? 'warn' : 'ok';
    const text = `Lowest ${DIM_LABEL[dim]} limit: ${formatDim(dim, t.limit, system)} at ${t.name}. You: ${formatDim(dim, dims[dim], system)}.`;
    ul.append(limitItem(text, t.at, cls));
  }
  box.append(ul);

  if (d.avoided && d.avoided.length) {
    box.append(el('h3', null, 'Avoided because of your vehicle'));
    const al = el('ul', 'limits');
    for (const v of d.avoided) al.append(limitItem(blockText(v, dims, system, d.carTotalKm), v.at, 'bad'));
    box.append(al);
    const extra = result.trips[result.selected].summary.time - d.carTime;
    if (extra >= 60) box.append(el('p', 'note', `Avoiding these makes this route ${formatDuration(extra)} longer than a car's.`));
  } else if (d.avoided) {
    box.append(el('p', 'note', 'No mapped limit on a car\'s route stops your vehicle, so its size isn\'t forcing a detour here.'));
  }

  box.append(el('p', 'note', `Checked ${d.roadCount.toLocaleString()} road segments in OpenStreetMap. Limits that nobody has mapped, and some single-point barriers, are not listed, so always obey the signs.`));
}

async function computeDetails(result, i) {
  const trip = result.trips[i];
  const { roads, totalKm } = await Restrictions.roadsOf(trip, 'truck', { truck: result.truckOptions }, decodePolyline6);
  const summary = Restrictions.summarize(roads, result.dims);
  const pick = (r) => ({ name: r.name, at: r.at, km: r.km });
  const asItem = (v) => ({ dim: v.dim, limit: v.limit, value: v.value, ...pick(v.road) });
  const details = {
    roadCount: summary.roadCount,
    totalKm,
    tightest: Object.fromEntries(Object.entries(summary.tightest)
      .map(([dim, t]) => [dim, { limit: t.limit, margin: t.margin, ...pick(t.road) }])),
    conditional: summary.conditional.map((c) => ({ value: c.value, ...pick(c.road) })),
    // The router normally avoids these; listing them catches rules it doesn't model.
    problems: Restrictions.avoided(roads, result.dims, result.hazmat).map(asItem),
  };
  const car = await carReference(result);
  if (car) {
    const used = new Set(roads.map((r) => r.id));
    details.avoided = Restrictions.avoided(car.roads, result.dims, result.hazmat, used).map(asItem);
    details.carTime = car.time;
    details.carTotalKm = car.totalKm;
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
        const { roads, totalKm } = await Restrictions.roadsOf(carTrip, 'auto', {}, decodePolyline6);
        return { roads, totalKm, time: carTrip.summary.time, line: tripLine(carTrip) };
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
    renderRouteChoices(result);
    renderVerdict(result);
    if (result.selected === i) renderLimits(result);
    persistResult(result);
  }
  if (result.details[i].transient) delete result.details[i];
}

// Selected route first, then the others, one at a time to go easy on the free servers.
async function loadAllDetails(result) {
  const order = [result.selected, ...result.trips.map((_, i) => i).filter((i) => i !== result.selected)];
  for (const i of order) {
    if (currentResult !== result) return;
    await loadDetails(result, i);
  }
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

async function explainNoRoute(result, code) {
  setMode(false);
  const box = els.verdict;
  const title = code === 'no_road'
    ? 'No road for this vehicle near the start or destination'
    : 'No route fits this vehicle';
  const head = () => {
    box.className = 'verdict bad';
    box.replaceChildren(el('p', 'verdict-title', title));
  };
  head();
  box.append(el('p', 'verdict-sub', 'Finding which part is blocked…'));
  if (routeLayer) routeLayer.remove();
  els.map.hidden = true;

  const car = await carReference(result);
  if (currentResult !== result) return;
  head();
  if (!car) {
    box.append(el('p', 'verdict-sub', 'Couldn\'t check which roads block it. Check your connection, the destination and your vehicle\'s sizes.'));
    return;
  }
  const blocking = Restrictions.avoided(car.roads, result.dims, result.hazmat)
    .map((v) => ({ dim: v.dim, limit: v.limit, value: v.value, name: v.road.name, at: v.road.at, km: v.road.km }));
  if (blocking.length) {
    box.append(el('p', 'verdict-sub', 'A car can make this trip, but these parts of its route aren\'t allowed for your vehicle, and there is no way around them:'));
    box.append(issueList(blocking.map((v) => ({ text: blockText(v, result.dims, result.system, car.totalKm), at: v.at })), 'bad'));
  } else {
    box.append(el('p', 'verdict-sub', 'No mapped size limit on a car\'s route stops your vehicle. The block is probably a turn or access rule near the start or destination.'));
  }
  box.append(el('p', 'verdict-sub', NEXT_STEPS));
  drawNoRoute(result, car, blocking);
}

function ensureMap() {
  if (typeof L === 'undefined') return false;
  els.map.hidden = false;
  if (!map) {
    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  }
  if (routeLayer) routeLayer.remove();
  if (focusMarker) focusMarker.remove();
  return true;
}

function endpointMarkers(result) {
  const { from, to } = result;
  return [
    L.circleMarker([from.lat, from.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2e7d32', fillOpacity: 1 }),
    L.circleMarker([to.lat, to.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#c62828', fillOpacity: 1 }),
  ];
}

function showLayers(layers) {
  routeLayer = L.featureGroup(layers).addTo(map);
  map.invalidateSize();
  map.fitBounds(routeLayer.getBounds(), { padding: [24, 24] });
}

const GAP_STYLE = { color: '#c62828', weight: 4, dashArray: '6 8', opacity: 0.9 };

function drawMap(result) {
  if (!ensureMap()) return;
  const layers = [];
  result.trips.forEach((trip, i) => {
    if (i === result.selected) return;
    const line = L.polyline(tripLine(trip), { color: '#8e8e93', weight: 5, opacity: 0.8 });
    line.on('click', () => selectRoute(result, i));
    layers.push(line);
  });
  const line = tripLine(result.trips[result.selected]);
  layers.push(L.polyline(line, { color: '#0b5cad', weight: 6, opacity: 0.9 }));
  const from = [result.from.lat, result.from.lon];
  const to = [result.to.lat, result.to.lon];
  if (distanceKm(from, line[0]) > GAP_KM) layers.push(L.polyline([from, line[0]], GAP_STYLE));
  if (distanceKm(to, line[line.length - 1]) > GAP_KM) layers.push(L.polyline([line[line.length - 1], to], GAP_STYLE));
  showLayers([...layers, ...endpointMarkers(result)]);
}

function drawNoRoute(result, car, blocking) {
  if (!ensureMap()) return;
  const layers = [L.polyline(car.line, { color: '#8e8e93', weight: 5, opacity: 0.7, dashArray: '8 8' })];
  for (const v of blocking) {
    layers.push(L.circleMarker(v.at, { radius: 9, color: '#fff', weight: 3, fillColor: '#c62828', fillOpacity: 1 })
      .bindPopup(violationText(v, result.system)));
  }
  showLayers([...layers, ...endpointMarkers(result)]);
}

function showOnMap(at, text) {
  if (!map || !at || els.map.hidden) return;
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
      if (e.code !== 'no_route' && e.code !== 'no_road') throw e;
      explainNoRoute(result, e.code);
      els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    renderResult(result);
    persistResult(result);
    els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    loadAllDetails(result);
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
  const state = loadState();
  if (state.units) form.elements.units.value = state.units;
  updateUnitLabels();
  fillVehicleSelect(state.preset || 'standard_semi');
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
    if (navigator.onLine) loadAllDetails(r);
  }

  els.preset.addEventListener('change', () => {
    applyPreset(els.preset.value);
    saveState();
  });
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
  initProfile();

  window.addEventListener('online', updateNetStatus);
  window.addEventListener('offline', updateNetStatus);
  updateNetStatus();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// --- My vehicles -----------------------------------------------------------

const prof = {
  dialog: $('profile'),
  list: $('vehicle-list'),
  empty: $('vehicle-empty'),
  form: $('save-vehicle'),
  name: $('vehicle-name'),
  summary: $('save-summary'),
  error: $('save-error'),
  status: $('backup-status'),
};

function sizeSummary(dims) {
  const system = units();
  return `${formatDim('weight', dims.weight, system)} · ${formatDim('height', dims.height, system)} high · `
    + `${formatDim('width', dims.width, system)} wide · ${formatDim('length', dims.length, system)} long`;
}

function selectVehicle(key) {
  fillVehicleSelect(key);
  applyPreset(els.preset.value);
  saveState();
}

function renderProfile() {
  const saved = Vehicles.list();
  prof.list.replaceChildren();
  prof.empty.hidden = saved.length > 0;
  for (const v of saved) {
    const key = SAVED_PREFIX + v.id;
    const li = el('li', 'vehicle');
    const name = el('input', 'vehicle-name');
    name.type = 'text';
    name.value = v.name;
    name.maxLength = 60;
    name.setAttribute('aria-label', 'Vehicle name');
    name.addEventListener('change', () => {
      if (!name.value.trim()) { name.value = v.name; return; }
      Vehicles.update(v.id, { name: name.value });
      fillVehicleSelect(els.preset.value);
    });
    const meta = el('div', 'vehicle-meta', sizeSummary(v));
    const actions = el('div', 'vehicle-actions');
    const inUse = els.preset.value === key;
    const use = el('button', 'small-btn', inUse ? 'In use' : 'Use');
    use.type = 'button';
    use.disabled = inUse;
    use.addEventListener('click', () => {
      selectVehicle(key);
      prof.dialog.close();
    });
    const del = el('button', 'small-btn ghost danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => {
      if (!confirm(`Delete "${v.name}"?`)) return;
      const wasSelected = els.preset.value === key;
      Vehicles.remove(v.id);
      fillVehicleSelect(wasSelected ? 'custom' : els.preset.value);
      saveState();
      renderProfile();
    });
    actions.append(use, del);
    li.append(name, meta, actions);
    prof.list.append(li);
  }

  prof.error.hidden = true;
  try {
    prof.summary.textContent = sizeSummary(readDimensions());
  } catch (_) {
    prof.summary.textContent = 'Fill in all four sizes in the form first.';
  }
}

function openProfile(focusName) {
  prof.status.textContent = '';
  renderProfile();
  prof.dialog.showModal();
  if (focusName) prof.name.focus();
}

function onSaveVehicle(event) {
  event.preventDefault();
  const showSaveError = (msg) => { prof.error.textContent = msg; prof.error.hidden = false; };
  let dims;
  try {
    dims = readDimensions();
  } catch (e) {
    return showSaveError('Fill in all four sizes in the form first.');
  }
  const name = prof.name.value.trim();
  if (!name) return showSaveError('Give this vehicle a name.');
  const existing = Vehicles.list().find((v) => v.name.toLowerCase() === name.toLowerCase());
  let id;
  if (existing) {
    if (!confirm(`Replace the sizes saved for "${existing.name}"?`)) return;
    Vehicles.update(existing.id, dims);
    id = existing.id;
  } else {
    id = Vehicles.add(name, dims).id;
  }
  prof.name.value = '';
  selectVehicle(SAVED_PREFIX + id);
  renderProfile();
  prof.status.textContent = `Saved "${name}".`;
}

async function onExport() {
  const file = new File([Vehicles.exportJson()], 'trailer-route-vehicles.json', { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Trailer Route vehicles' });
      prof.status.textContent = 'Backup shared. Keep it somewhere safe, like Files or iCloud Drive.';
    } catch (e) {
      if (e.name !== 'AbortError') prof.status.textContent = 'Couldn\'t share the backup.';
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const a = el('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  prof.status.textContent = 'Backup downloaded.';
}

async function onImport(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const added = Vehicles.importJson(await file.text());
    fillVehicleSelect(els.preset.value);
    renderProfile();
    prof.status.textContent = added ? `Restored ${added} vehicle${added === 1 ? '' : 's'}.` : 'Nothing new: these vehicles are already saved.';
  } catch (e) {
    prof.status.textContent = e.message;
  }
}

function initProfile() {
  $('open-profile').addEventListener('click', () => openProfile(false));
  $('save-current').addEventListener('click', () => openProfile(true));
  prof.form.addEventListener('submit', onSaveVehicle);
  $('export-vehicles').addEventListener('click', onExport);
  $('import-vehicles').addEventListener('change', onImport);
  prof.dialog.querySelector('[data-close]').addEventListener('click', () => prof.dialog.close());
  prof.dialog.addEventListener('click', (e) => { if (e.target === prof.dialog) prof.dialog.close(); });
}

init();
