import { quantile } from './model.mjs';
const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function drawHistory(container, details, history, archive, selected, coverage, format, select) {
  const width = Math.max(280, container.clientWidth), height = 320;
  const left = width < 550 ? 73 : 100, right = 18, top = 22, bottom = 46;
  const points = history.map(p => p.model.error ? { at: p.at } : {
    at: p.at, reaction: p.reaction, median: p.model.median,
    low: quantile(p.model.points, (1 - coverage) / 2),
    high: quantile(p.model.points, (1 + coverage) / 2),
  });
  const values = points.flatMap(p => [p.low?.time, p.high?.time, p.median?.time]).filter(Number.isFinite);
  const first = points[0].at, last = Math.max(points.at(-1).at, archive.reference.at);
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
  const reactionX = x(archive.reference.at);
  svg.push(`<rect x="${reactionX}" y="${top}" width="${Math.max(0,width-right-reactionX)}" height="${height-top-bottom}" fill="#edf1ed"/>`);
  svg.push(`<line x1="${reactionX}" x2="${reactionX}" y1="${top}" y2="${height-bottom}" stroke="#93a799" stroke-dasharray="3 4"/>`);
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
  svg.push(`<circle cx="${x(archive.reference.at)}" cy="${actualY}" r="5.5" fill="#2f855c" stroke="#f8f9f5" stroke-width="2"/>`);
  svg.push(`<text x="${x(archive.reference.at)-10}" y="${actualY-10}" text-anchor="end" fill="#2f855c" font-size="10" font-weight="600">Lifted ${escape(format(archive.reference.at))}</text>`);
  for (const run of runs(p => p.median && !p.median.edge && !p.reaction)) {
    svg.push(`<path d="${path(run, 'median')}" fill="none" stroke="#de773e" stroke-width="2.5" stroke-linejoin="round"/>`);
  }
  for (const run of runs(p => p.median && !p.median.edge && p.reaction)) {
    svg.push(`<path d="${path(run, 'median')}" fill="none" stroke="#de773e" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="4 3"/>`);
  }
  // Triangles point toward the unobserved tail; they are bounds, not finite medians.
  for (const p of points.filter(p => p.median?.edge)) {
    const direction = p.median.edge === 'after' ? 1 : -1;
    svg.push(`<path d="M${x(p.at)-3},${y(p.median.time)+3*direction} l3,${-6*direction} l3,${6*direction}" fill="none" stroke="#de773e"/>`);
  }
  const point = points[selected];
  svg.push(`<line data-cursor x1="${x(point.at)}" x2="${x(point.at)}" y1="${top}" y2="${height-bottom}" stroke="#88988d" stroke-dasharray="2 4"/>`);
  svg.push('<circle data-marker r="4.5" fill="#243b33" stroke="#f8f9f5" stroke-width="2"/>');
  const ticks = width < 550 ? 3 : 5;
  for (let i = 0; i < ticks; i++) {
    const t = first + (last-first)*i/(ticks-1);
    svg.push(`<text x="${x(t)}" y="${height-23}" text-anchor="${i===0?'start':i===ticks-1?'end':'middle'}" fill="#7b8880" font-size="10">${escape(format(t))}</text>`);
  }
  svg.push(`<text x="${left}" y="12" fill="#7b8880" font-size="9">IMPLIED ANNOUNCEMENT</text>`, '</svg>');
  container.innerHTML = svg.join('');
  const cursor = container.querySelector('[data-cursor]');
  const marker = container.querySelector('[data-marker]');
  const date = t => format(t, { month: 'short', day: 'numeric', timeZoneName: 'short' });
  const label = q => !q ? 'Unavailable' : `${q.edge === 'after' ? 'After ' : q.edge === 'before' ? 'Before ' : ''}${date(q.time)}`;
  function comparison(median) {
    if (median.edge) return 'Only a median bound is available.';
    const minutes = Math.round((median.time - archive.reference.at) / 60000);
    if (!minutes) return 'Within 1 min of reopening';
    const duration = `${Math.floor(Math.abs(minutes)/60) ? `${Math.floor(Math.abs(minutes)/60)}h ` : ''}${Math.abs(minutes)%60}m`;
    return `${duration} ${minutes > 0 ? 'later' : 'earlier'} than reopening`;
  }
  let current = selected;
  function show(index, notify = true) {
    current = index;
    const p = points[index], model = history[index].model;
    cursor.setAttribute('x1', x(p.at)); cursor.setAttribute('x2', x(p.at));
    marker.setAttribute('visibility', p.median && !p.median.edge ? 'visible' : 'hidden');
    if (p.median) { marker.setAttribute('cx', x(p.at)); marker.setAttribute('cy', y(p.median.time)); }
    details.innerHTML = `<div class="tooltip-label">${history[index].reaction ? 'Market reaction at' : 'Forecast at'}</div><div class="tooltip-time">${escape(date(p.at))}</div>` +
      (model.error ? '<p class="tooltip-empty">Not enough quotes at this minute.</p>' :
        `<div class="tooltip-label">Median announcement time</div><div class="tooltip-eta">${escape((p.median.edge === 'after' ? 'After ' : p.median.edge === 'before' ? 'Before ' : '') + format(p.median.time))}</div><div class="tooltip-date">${escape(format(p.median.time, {month:'short',day:'numeric',hour:undefined,minute:undefined}))}</div><div class="tooltip-label">${Math.round(coverage*100)}% market-implied range</div><div class="tooltip-range">${escape(label(p.low))}<br>– ${escape(label(p.high))}</div><div class="tooltip-comparison">${escape(comparison(p.median))}</div><div class="tooltip-count">${model.quoteCount} quotes · ${model.settlementCount} settled</div>`);
    if (notify) select(index);
  }
  show(selected, false);
  function inspect(event) {
    const rect = container.querySelector('svg').getBoundingClientRect();
    const scale = Math.min(rect.width / width, rect.height / height);
    const offset = (rect.width - width * scale) / 2;
    const t = first + ((event.clientX - rect.left - offset) / scale - left) / (width-left-right) * (last-first);
    const index = Math.max(0, Math.min(history.length-1, Math.round((t-first)/60000)));
    if (index !== current) show(index);
  }
  container.onpointermove = inspect;
  container.onpointerdown = inspect;
  container.onclick = null;
  container.onkeydown = event => {
    const keys = {ArrowLeft:current-1, ArrowRight:current+1, Home:0, End:history.length-1};
    if (!(event.key in keys)) return;
    event.preventDefault();
    show(Math.max(0, Math.min(history.length-1, keys[event.key])));
  };
}
