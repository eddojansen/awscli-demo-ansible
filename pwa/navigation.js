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

  function sample(line) {
    const out = [line[0]];
    let acc = 0;
    for (let i = 1; i < line.length; i++) {
      acc += distanceKm(line[i - 1], line[i]);
      if (acc >= SAMPLE_KM) {
        out.push(line[i]);
        acc = 0;
      }
    }
    if (out[out.length - 1] !== line[line.length - 1]) out.push(line[line.length - 1]);
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

  // Points on `line` that keep an app off `ref`: one per stretch where they differ, biggest first.
  function pins(line, ref, max) {
    if (!line.length || max <= 0) return [];
    if (!ref || ref.length < 2) return evenly(line, Math.min(max, 3));
    const dist = nearLine(ref);
    const pts = sample(line);
    const stretches = [];
    let cur = null;
    pts.forEach((p, i) => {
      const d = dist(p);
      if (d > OFF_ROUTE_KM) {
        if (!cur) cur = { points: [], start: i };
        cur.points.push({ p, d, i });
      } else if (cur) {
        stretches.push(cur);
        cur = null;
      }
    });
    if (cur) stretches.push(cur);
    return stretches
      // ignore slip-road-sized differences
      .filter((s) => s.points.length >= 3 || Math.max(...s.points.map((x) => x.d)) > 0.3)
      .map((s) => {
        const top = s.points.reduce((a, b) => (b.d > a.d ? b : a));
        return { at: top.p, order: top.i, weight: top.d * s.points.length };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, max)
      .sort((a, b) => a.order - b.order)
      .map((s) => s.at);
  }

  function evenly(line, n) {
    const out = [];
    for (let k = 1; k <= n; k++) out.push(line[Math.floor((line.length - 1) * (k / (n + 1)))]);
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
