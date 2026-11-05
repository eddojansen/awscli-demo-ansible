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

  // Stops that keep a navigation app on `line`:
  // - one per stretch where `line` leaves `ref` (the road a car, and so the app, would take),
  //   biggest first;
  // - on longer routes, anchors spread along the way, because the app may not choose
  //   the car route either.
  // `candidates` ({at, km}) are safe points for stops; without them we use the line itself.
  function pins(line, ref, max, candidates) {
    if (!line.length || max <= 0) return [];
    const pts = sample(line);
    const totalKm = pts[pts.length - 1].km;
    const safe = candidates && candidates.length ? candidates : null;
    const nearestSafe = (km, within) => {
      if (!safe) return null;
      let best = null;
      for (const c of safe) {
        const d = Math.abs(c.km - km);
        if (d <= within && (!best || d < Math.abs(best.km - km))) best = c;
      }
      return best;
    };

    const chosen = [];
    if (ref && ref.length >= 2) {
      const dist = nearLine(ref);
      const stretches = [];
      let cur = null;
      for (const s of pts) {
        const d = dist(s.p);
        if (d > OFF_ROUTE_KM) {
          if (!cur) cur = { points: [] };
          cur.points.push({ ...s, d });
        } else if (cur) {
          stretches.push(cur);
          cur = null;
        }
      }
      if (cur) stretches.push(cur);
      for (const st of stretches) {
        const top = st.points.reduce((x, y) => (y.d > x.d ? y : x));
        // ignore slip-road-sized differences
        if (st.points.length < 3 && top.d <= 0.3) continue;
        const from = st.points[0].km, to = st.points[st.points.length - 1].km;
        const inside = safe ? safe.filter((x) => x.km >= from && x.km <= to) : [];
        const c = inside.length ? inside.reduce((x, y) => (Math.abs(y.km - top.km) < Math.abs(x.km - top.km) ? y : x)) : null;
        chosen.push({ at: c ? c.at : top.p, km: c ? c.km : top.km, weight: top.d * st.points.length });
      }
      chosen.sort((x, y) => y.weight - x.weight);
      chosen.splice(max);
    } else if (!safe) {
      return evenly(pts, Math.min(max, 3), totalKm).map((x) => x.p);
    }

    const anchors = totalKm > 20 ? 2 : totalKm > 5 ? 1 : 0;
    for (let k = 1; k <= anchors && chosen.length < max; k++) {
      const target = (totalKm * k) / (anchors + 1);
      const c = nearestSafe(target, totalKm / (2 * (anchors + 1)));
      if (c && !chosen.some((x) => Math.abs(x.km - c.km) < Math.max(1, totalKm / 10))) chosen.push({ at: c.at, km: c.km });
    }
    return chosen.sort((x, y) => x.km - y.km).map((x) => x.at);
  }

  function evenly(pts, n, totalKm) {
    const out = [];
    for (let k = 1; k <= n; k++) {
      const target = (totalKm * k) / (n + 1);
      out.push(pts.reduce((a, b) => (Math.abs(b.km - target) < Math.abs(a.km - target) ? b : a)));
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

  return { APPS, pins, url, gpx, appleSupportsStops };
})();
