'use strict';

// Reads the road limits mapped in OpenStreetMap along a route.
// Valhalla avoids roads whose limits your vehicle exceeds, but doesn't say which ones,
// so we ask it which OSM ways the route uses and look up their tags.
const Restrictions = (() => {
  const TRACE_URL = 'https://valhalla1.openstreetmap.de/trace_attributes';
  const OSM_WAYS_URL = 'https://api.openstreetmap.org/api/0.6/ways.json';
  const OSM_BATCH = 500;
  const LB_PER_T = 2204.62262;
  const ST_IN_T = 0.90718474;

  // dimension -> OSM keys that limit it (lowest value wins)
  const KEYS = {
    height: ['maxheight', 'maxheight:physical'],
    width: ['maxwidth', 'maxwidth:physical'],
    length: ['maxlength', 'maxlength:hgv'],
    weight: ['maxweight', 'maxweightrating', 'maxweight:hgv', 'maxweightrating:hgv'],
  };
  const HGV_BLOCKED = new Set(['no']);
  const HGV_LIMITED = new Set(['destination', 'delivery', 'private', 'permit', 'agricultural']);

  const tagCache = new Map(); // way id -> tags

  // "4.5", "4.5 m", "4.5m", "14'6\"", "14 ft" -> metres; "default", "none" etc. -> null
  function parseLength(raw) {
    const v = String(raw).trim().toLowerCase();
    let m = v.match(/^(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?$/);
    if (m) return +m[1];
    m = v.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?))?$/);
    if (m) return (+m[1] * 12 + (+m[2] || 0)) * 0.0254;
    return null;
  }

  // "7.5", "7.5 t", "7500 kg", "15000 lbs", "10 st" -> tonnes
  function parseWeight(raw) {
    const m = String(raw).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(t|kg|lbs?|st)?$/);
    if (!m) return null;
    const n = +m[1];
    switch (m[2]) {
      case 'kg': return n / 1000;
      case 'lb': case 'lbs': return n / LB_PER_T;
      case 'st': return n * ST_IN_T;
      default: return n;
    }
  }

  function limitsOf(tags) {
    const out = {};
    for (const [dim, keys] of Object.entries(KEYS)) {
      for (const k of keys) {
        if (!(k in tags)) continue;
        const val = dim === 'weight' ? parseWeight(tags[k]) : parseLength(tags[k]);
        if (val != null && val > 0 && (out[dim] == null || val < out[dim])) out[dim] = val;
      }
    }
    return out;
  }

  async function trace(trip, costing, costingOptions) {
    const res = await fetch(TRACE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encoded_polyline: trip.legs.map((l) => l.shape).join(''),
        shape_match: 'edge_walk',
        costing,
        costing_options: costingOptions,
        filters: { attributes: ['edge.way_id', 'edge.names', 'edge.begin_shape_index', 'edge.end_shape_index', 'edge.length', 'shape'], action: 'include' },
      }),
    });
    if (!res.ok) throw new Error(`trace failed (${res.status})`);
    return res.json();
  }

  async function fetchTags(ids) {
    const missing = ids.filter((id) => !tagCache.has(id));
    for (let i = 0; i < missing.length; i += OSM_BATCH) {
      const batch = missing.slice(i, i + OSM_BATCH);
      const res = await fetch(`${OSM_WAYS_URL}?ways=${batch.join(',')}`);
      if (!res.ok) throw new Error(`OSM lookup failed (${res.status})`);
      const data = await res.json();
      for (const el of data.elements) tagCache.set(el.id, el.tags || {});
      for (const id of batch) if (!tagCache.has(id)) tagCache.set(id, {});
    }
  }

  // Roads along a trip in driving order, each with where it starts (`at`, `km` from the start).
  // Multi-leg routes join their shapes; the first point of each later leg repeats the
  // previous leg's last point, which edge_walk tolerates.
  async function roadsOf(trip, costing, costingOptions, decode) {
    const t = await trace(trip, costing, costingOptions);
    const shape = decode(t.shape);
    const seen = new Map();
    let km = 0;
    for (const e of t.edges) {
      if (!seen.has(e.way_id)) {
        seen.set(e.way_id, {
          id: e.way_id,
          ref: (e.names && e.names[0]) || '',
          at: shape[e.begin_shape_index] || shape[0],
          km,
          mid: shape[Math.floor((e.begin_shape_index + e.end_shape_index) / 2)] || shape[0],
          midKm: km + (e.length || 0) / 2,
        });
      }
      km += e.length || 0;
    }
    await fetchTags([...seen.keys()]);
    const roads = [...seen.values()].map((r) => {
      const tags = tagCache.get(r.id) || {};
      return { ...r, name: tags.name || r.ref || tags.ref || 'Unnamed road', tags, limits: limitsOf(tags) };
    });
    return { roads, totalKm: km, shape };
  }

  // Which mapped rules this vehicle breaks on a road.
  function violations(road, dims, hazmat) {
    const out = [];
    for (const dim of Object.keys(KEYS)) {
      const lim = road.limits[dim];
      if (lim != null && dims[dim] > lim + 1e-6) out.push({ dim, limit: lim });
    }
    if (HGV_BLOCKED.has(road.tags.hgv)) out.push({ dim: 'hgv', value: road.tags.hgv });
    if (hazmat && road.tags.hazmat === 'no') out.push({ dim: 'hazmat' });
    return out;
  }

  // Tightest limit per dimension on a route, plus roads with access conditions.
  function summarize(roads, dims) {
    const tightest = {};
    const conditional = [];
    for (const r of roads) {
      for (const [dim, lim] of Object.entries(r.limits)) {
        if (!tightest[dim] || lim < tightest[dim].limit) tightest[dim] = { limit: lim, road: r, margin: lim - dims[dim] };
      }
      if (HGV_LIMITED.has(r.tags.hgv)) conditional.push({ road: r, value: r.tags.hgv });
    }
    return { tightest, conditional, roadCount: roads.length };
  }

  // Roads a reference (car) route uses that this vehicle may not, grouped by road name + rule.
  function avoided(referenceRoads, dims, hazmat, usedIds = new Set()) {
    const groups = new Map();
    for (const r of referenceRoads) {
      if (usedIds.has(r.id)) continue;
      for (const v of violations(r, dims, hazmat)) {
        const key = `${r.name}|${v.dim}|${v.limit ?? v.value ?? ''}`;
        if (!groups.has(key)) groups.set(key, { road: r, ...v });
      }
    }
    return [...groups.values()];
  }

  // Points where a navigation app can't misread a stop: mid-way along two-way, non-motorway
  // roads (a stop on a dual carriageway can snap to the other direction).
  const DUAL = /^(motorway|motorway_link)$/;
  function pinCandidates(roads) {
    return roads
      .filter((r) => r.tags.oneway !== 'yes' && r.tags.oneway !== '-1' && !DUAL.test(r.tags.highway || '')
        && !r.tags.junction && r.tags.highway)
      .map((r) => ({ at: r.mid, km: r.midKm }));
  }

  return { roadsOf, summarize, avoided, pinCandidates, parseLength, parseWeight };
})();
