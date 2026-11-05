'use strict';

// Saved vehicles, stored on this device. Sizes are metric: tonnes and metres.
const Vehicles = (() => {
  const KEY = 'trailer-route:vehicles';
  const FIELDS = ['weight', 'height', 'width', 'length'];

  function valid(v) {
    return v && typeof v.name === 'string' && v.name.trim()
      && FIELDS.every((f) => Number.isFinite(v[f]) && v[f] > 0);
  }

  function clean(v) {
    const out = { id: String(v.id || newId()), name: v.name.trim().slice(0, 60) };
    for (const f of FIELDS) out[f] = v[f];
    return out;
  }

  function newId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function list() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(data) ? data.filter(valid) : [];
    } catch (_) {
      return [];
    }
  }

  function write(vehicles) {
    localStorage.setItem(KEY, JSON.stringify(vehicles));
  }

  function get(id) {
    return list().find((v) => v.id === id) || null;
  }

  function add(name, dims) {
    const v = clean({ name, ...dims });
    write([...list(), v]);
    return v;
  }

  function update(id, changes) {
    write(list().map((v) => (v.id === id ? clean({ ...v, ...changes, id }) : v)));
  }

  function remove(id) {
    write(list().filter((v) => v.id !== id));
  }

  function exportJson() {
    return JSON.stringify({ app: 'trailer-route', version: 1, vehicles: list() }, null, 2);
  }

  // Adds vehicles from a backup, skipping ones already saved. Returns how many were added.
  function importJson(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error('This file isn\'t a Trailer Route backup.');
    }
    const incoming = Array.isArray(data) ? data : data && data.vehicles;
    if (!Array.isArray(incoming)) throw new Error('This file isn\'t a Trailer Route backup.');
    const current = list();
    const same = (a, b) => a.name.trim() === b.name.trim() && FIELDS.every((f) => a[f] === b[f]);
    const added = [];
    for (const v of incoming.filter(valid)) {
      if (current.some((c) => same(c, v)) || added.some((a) => same(a, v))) continue;
      const taken = [...current, ...added].some((c) => c.id === String(v.id));
      added.push(clean({ ...v, id: taken ? newId() : v.id }));
    }
    write([...current, ...added]);
    return added.length;
  }

  return { list, get, add, update, remove, exportJson, importJson };
})();

// Preferences such as the navigation app, stored on this device.
const Settings = (() => {
  const KEY = 'trailer-route:settings';

  function all() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (_) {
      return {};
    }
  }

  function get(name, fallback) {
    const v = all()[name];
    return v === undefined ? fallback : v;
  }

  function set(name, value) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...all(), [name]: value }));
    } catch (_) { /* storage full or disabled */ }
  }

  return { get, set };
})();
