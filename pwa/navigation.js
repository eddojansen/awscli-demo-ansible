'use strict';

// Hands a planned route to a navigation app. Apps only take a few stops, so we pin
// the route where it leaves the road a car (and so the app) would most likely take.
const Navigation = (() => {
  const APPS = {
    apple: { label: 'Apple Maps', maxPins: 5 },
    google: { label: 'Google Maps', maxPins: 3 },
    waze: { label: 'Waze', maxPins: 0 },
    gpx: { label: 'Route file (GPX)', maxPins: 0 },
  };
  const OFF_ROUTE_KM = 0.15;
  const SAMPLE_KM = 0.1;
  const CELL_DEG = 0.01;

  function distanceKm(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad;
    const dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }

  // Distance from p to segment ab, on a flat projection around p (fine at these scales).
  function segmentKm(p, a, b) {
    const kx = 111.32 * Math.cos((p[0] * Math.PI) / 180);
    const ky = 110.57;
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky;
    const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
  }

  // Points about SAMPLE_KM apart, each with its distance from the start.
  function sample(line) {
    const out = [{ p: line[0], km: 0 }];
    let km = 0;
    let acc = 0;
    for (let i = 1; i < line.length; i++) {
      const d = distanceKm(line[i - 1], line[i]);
      km += d;
      acc += d;
      if (acc >= SAMPLE_KM || i === line.length - 1) {
        out.push({ p: line[i], km });
        acc = 0;
      }
    }
    return out;
  }

  function nearLine(ref) {
    const grid = new Map();
    const cell = (v) => Math.floor(v / CELL_DEG);
    for (let i = 1; i < ref.length; i++) {
      const [a, b] = [ref[i - 1], ref[i]];
      for (let la = cell(Math.min(a[0], b[0])); la <= cell(Math.max(a[0], b[0])); la++) {
        for (let lo = cell(Math.min(a[1], b[1])); lo <= cell(Math.max(a[1], b[1])); lo++) {
          const k = `${la},${lo}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(i);
        }
      }
    }
    return (p) => {
      let best = Infinity;
      const [la, lo] = [cell(p[0]), cell(p[1])];
      for (let x = la - 1; x <= la + 1; x++) {
        for (let y = lo - 1; y <= lo + 1; y++) {
          for (const i of grid.get(`${x},${y}`) || []) best = Math.min(best, segmentKm(p, ref[i - 1], ref[i]));
        }
      }
      return best;
    };
  }

  // Where `line` strays from `ref` (the route a car, and so the navigation app, would take),
  // as stretches of sampled points with their distance from `ref`.
  function stretchesOff(line, ref) {
    const pts = sample(line);
    const dist = nearLine(ref);
    const out = [];
    let cur = null;
    for (const s of pts) {
      const d = dist(s.p);
      if (d > OFF_ROUTE_KM) {
        if (!cur) cur = [];
        cur.push({ ...s, d });
      } else if (cur) {
        out.push(cur);
        cur = null;
      }
    }
    if (cur) out.push(cur);
    // ignore slip-road-sized differences
    return out.filter((st) => st.length >= 3 || Math.max(...st.map((x) => x.d)) > 0.3);
  }

  // The next stop to add: in the biggest stretch where `ref` still leaves `line`, at the point
  // farthest from `ref`. A safe candidate ({at, km}: mid-way along a two-way, non-motorway road)
  // in that stretch is preferred, because a stop on a dual carriageway can snap to the other side.
  // Returns null when `ref` already follows `line`.
  function nextPin(line, ref, candidates) {
    const stretches = stretchesOff(line, ref);
    if (!stretches.length) return null;
    const weight = (st) => Math.max(...st.map((x) => x.d)) * st.length;
    const st = stretches.reduce((a, b) => (weight(b) > weight(a) ? b : a));
    const top = st.reduce((a, b) => (b.d > a.d ? b : a));
    const from = st[0].km, to = st[st.length - 1].km;
    const inside = (candidates || []).filter((c) => c.km >= from && c.km <= to);
    const c = inside.length ? inside.reduce((x, y) => (Math.abs(y.km - top.km) < Math.abs(x.km - top.km) ? y : x)) : null;
    return c ? { at: c.at, km: c.km } : { at: top.p, km: top.km };
  }

  // A stop near the middle of each long stretch where `line` leaves `ref`, longest first.
  // Unlike nextPin's tipping-point stops, the app can't reach these by a slightly different
  // detour, so they hold even when its timings differ from ours.
  function middlePins(line, ref, candidates, max, minKm = 10) {
    return stretchesOff(line, ref)
      .map((st) => ({ from: st[0].km, to: st[st.length - 1].km, pts: st }))
      .filter((st) => st.to - st.from >= minKm)
      .sort((a, b) => (b.to - b.from) - (a.to - a.from))
      .slice(0, max)
      .map((st) => {
        const mid = (st.from + st.to) / 2;
        const inside = (candidates || []).filter((c) => c.km >= st.from && c.km <= st.to);
        if (inside.length) return inside.reduce((x, y) => (Math.abs(y.km - mid) < Math.abs(x.km - mid) ? y : x));
        const p = st.pts.reduce((x, y) => (Math.abs(y.km - mid) < Math.abs(x.km - mid) ? y : x));
        return { at: p.p, km: p.km };
      });
  }

  // Without a way to check, spread a few stops along the route.
  function fallbackPins(line, n) {
    const pts = sample(line);
    const total = pts[pts.length - 1].km;
    const out = [];
    for (let k = 1; k <= n; k++) {
      const target = (total * k) / (n + 1);
      out.push(pts.reduce((a, b) => (Math.abs(b.km - target) < Math.abs(a.km - target) ? b : a)).p);
    }
    return out;
  }

  const fmt = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

  // Unified Apple Maps links (with stops) need iOS 18.4+; older versions get the classic link.
  function appleSupportsStops() {
    const m = navigator.userAgent.match(/(?:iPhone|iPad|iPod).*? OS (\d+)_(\d+)/);
    if (!m) return true;
    const [major, minor] = [+m[1], +m[2]];
    return major > 18 || (major === 18 && minor >= 4);
  }

  // from/to: {lat, lon, current?}; pinPoints: [[lat, lon], ...]
  function url(app, from, to, pinPoints) {
    const dest = fmt([to.lat, to.lon]);
    const start = from.current ? null : fmt([from.lat, from.lon]);
    if (app === 'google') {
      const p = new URLSearchParams({ api: '1', destination: dest, travelmode: 'driving' });
      if (start) p.set('origin', start);
      if (pinPoints.length) p.set('waypoints', pinPoints.map(fmt).join('|'));
      return `https://www.google.com/maps/dir/?${p}`;
    }
    if (app === 'waze') {
      return `https://waze.com/ul?${new URLSearchParams({ ll: dest, navigate: 'yes' })}`;
    }
    if (!appleSupportsStops()) {
      const p = new URLSearchParams({ daddr: dest, dirflg: 'd' });
      if (start) p.set('saddr', start);
      return `https://maps.apple.com/?${p}`;
    }
    const p = new URLSearchParams({ destination: dest, mode: 'driving' });
    if (start) p.set('source', start);
    for (const pt of pinPoints) p.append('waypoint', fmt(pt));
    return `https://maps.apple.com/directions?${p}`;
  }

  const xml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

  function gpx(name, line) {
    const pts = line.map((p) => `      <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trailer Route" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(name)}</name></metadata>
  <trk>
    <name>${xml(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
  }

  return { APPS, MAX_PINS: 5, nextPin, middlePins, fallbackPins, url, gpx, appleSupportsStops };
})();
