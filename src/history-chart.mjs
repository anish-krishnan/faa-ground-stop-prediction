import { quantile } from './model.mjs';
const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function drawHistory(container, history, archive, selected, coverage, format, select) {
  const width = Math.max(280, container.clientWidth), height = 320;
  const left = width < 550 ? 73 : 100, right = 18, top = 22, bottom = 46;
  const points = history.map(p => p.model.error ? { at: p.at } : {
    at: p.at, median: p.model.median,
    low: quantile(p.model.points, (1 - coverage) / 2),
    high: quantile(p.model.points, (1 + coverage) / 2),
  });
  const values = points.flatMap(p => [p.low?.time, p.high?.time, p.median?.time]).filter(Number.isFinite);
  const first = points[0].at, last = points.at(-1).at;
  const min = Math.min(archive.reference.at, ...values), max = Math.max(archive.reference.at, ...values);
  const padding = Math.max(60000, (max - min) * .05);
  const x = t => left + (t - first) / (last - first || 1) * (width - left - right);
  const y = t => top + (max + padding - t) / (max - min + padding * 2) * (height - top - bottom);
  const path = (run, key) => run.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(2)},${y(p[key].time).toFixed(2)}`).join(' ');
  const runs = predicate => {
    const result = []; let current = [];
    for (const point of points) {
      if (predicate(point)) current.push(point);
      else if (current.length) { result.push(current); current = []; }
    }
    if (current.length) result.push(current);
    return result;
  };
  const svg = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Historical median announcement estimates and middle ${coverage * 100} percent range. Horizontal axis is forecast observation time; vertical axis is predicted announcement time.">`];
  for (let i = 0; i < 5; i++) {
    const t = min + (max - min) * i / 4;
    svg.push(`<line x1="${left}" x2="${width - right}" y1="${y(t)}" y2="${y(t)}" stroke="#e1e7df"/>`);
    svg.push(`<text x="${left - 10}" y="${y(t) - 3}" text-anchor="end" fill="#7b8880" font-size="10">${escape(format(t))}<tspan x="${left - 10}" dy="12">${escape(format(t, {month:'short', day:'numeric', hour:undefined, minute:undefined}))}</tspan></text>`);
  }
  for (const run of runs(p => p.low && !p.low.edge && !p.high.edge)) {
    const lower = run.slice().reverse().map(p => `L${x(p.at)},${y(p.low.time)}`).join(' ');
    svg.push(`<path d="${path(run, 'high')} ${lower} Z" fill="#dfe9e0" fill-opacity=".85"/>`);
  }
  const actualY = y(archive.reference.at);
  svg.push(`<line x1="${left}" x2="${width-right}" y1="${actualY}" y2="${actualY}" stroke="#50695c" stroke-dasharray="5 4"/>`);
  for (const run of runs(p => p.median && !p.median.edge)) {
    svg.push(`<path d="${path(run, 'median')}" fill="none" stroke="#de773e" stroke-width="2.5" stroke-linejoin="round"/>`);
  }
  // A triangle denotes a lower bound, never a finite median estimate.
  for (const p of points.filter(p => p.median?.edge === 'after')) {
    svg.push(`<path d="M${x(p.at)-3},${y(p.median.time)+3} l3,-6 l3,6" fill="none" stroke="#de773e"/>`);
  }
  const point = points[selected];
  svg.push(`<line x1="${x(point.at)}" x2="${x(point.at)}" y1="${top}" y2="${height-bottom}" stroke="#88988d" stroke-dasharray="2 4"/>`);
  if (point.median && !point.median.edge) svg.push(`<circle cx="${x(point.at)}" cy="${y(point.median.time)}" r="4.5" fill="#243b33" stroke="#f8f9f5" stroke-width="2"/>`);
  const ticks = width < 550 ? 3 : 5;
  for (let i = 0; i < ticks; i++) {
    const t = first + (last-first)*i/(ticks-1);
    svg.push(`<text x="${x(t)}" y="${height-23}" text-anchor="${i===0?'start':i===ticks-1?'end':'middle'}" fill="#7b8880" font-size="10">${escape(format(t))}</text>`);
  }
  svg.push(`<text x="${left}" y="12" fill="#7b8880" font-size="9">PREDICTED ANNOUNCEMENT</text>`, '</svg>');
  container.innerHTML = svg.join('');
  container.onclick = event => {
    const rect = container.querySelector('svg').getBoundingClientRect();
    const scale = Math.min(rect.width / width, rect.height / height);
    const offset = (rect.width - width * scale) / 2;
    const t = first + ((event.clientX - rect.left - offset) / scale - left) / (width-left-right) * (last-first);
    select(Math.max(0, Math.min(history.length-1, Math.round((t-first)/60000))));
  };
}
