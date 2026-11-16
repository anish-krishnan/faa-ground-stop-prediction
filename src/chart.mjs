const $ = id => document.getElementById(id);
const percent = probability => `${(100 * probability).toFixed(1)}%`;
const escape = text => String(text).replace(/[&<>"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[character]));

export function drawChart(model, low, high, formatDate, formatTime) {
  const width = Math.max(280, $('chart').clientWidth);
  const height = Math.max(220, $('chart').clientHeight);
  const left = 48, right = 22, top = 15, bottom = 42;
  const single = model.points.length === 1;
  const firstTime = model.points[0].t - (single ? 900000 : 0);
  const finalTime = model.last + (single ? 900000 : 0);
  const x = time => left + (time - firstTime) / (finalTime - firstTime) * (width - left - right);
  const y = probability => top + (1 - probability) * (height - top - bottom);
  const path = (points, key) => points.map((point, index) =>
    `${index ? 'L' : 'M'}${x(point.t).toFixed(2)},${y(point[key]).toFixed(2)}`,
  ).join(' ');

  const svg = [
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative probability by announcement deadline">`,
    ...(!low.edge && !high.edge ? [`<rect x="${x(low.time)}" y="${top}" width="${Math.max(0, x(high.time) - x(low.time))}" height="${height - top - bottom}" fill="#eaf0eb"/>`] : []),
  ];
  for (let p = 0; p <= 1; p += 0.25) {
    svg.push(`<line x1="${left}" y1="${y(p)}" x2="${width - right}" y2="${y(p)}" stroke="#e5eae5" stroke-dasharray="${p === 0.5 ? '4 4' : '0'}"/>`);
    svg.push(`<text x="${left - 12}" y="${y(p) + 4}" text-anchor="end" fill="#819088" font-size="10">${p * 100}%</text>`);
  }
  if ($('band').checked) {
    const lowerEdge = model.points.slice().reverse().map(point => `L${x(point.t)},${y(point.low)}`).join(' ');
    svg.push(`<path d="${path(model.points, 'high')} ${lowerEdge} Z" fill="#e46d32" fill-opacity=".14"/>`);
  }
  svg.push(`<path d="${path(model.points, 'p')}" stroke="#df7136" stroke-width="2.7" fill="none"/>`);
  const quotedRows = model.rows.filter(row => row.fitted != null && !row.result);
  for (const row of quotedRows) {
    svg.push(`<circle cx="${x(row.t)}" cy="${y(row.raw)}" r="3" stroke="#df7136" fill="white"><title>${escape(formatDate(row.t))} · midpoint ${percent(row.raw)} · bid ${percent(row.bid)} / ask ${percent(row.ask)}</title></circle>`);
  }
  for (const point of model.points.filter(point => point.result)) {
    svg.push(`<rect x="${x(point.t)-3}" y="${y(point.p)-3}" width="6" height="6" fill="#2f855c"><title>${escape(formatDate(point.t))} · settled ${point.result.toUpperCase()} · ${percent(point.p)}</title></rect>`);
  }
  if (!model.median.edge) {
    svg.push(`<line x1="${x(model.median.time)}" x2="${x(model.median.time)}" y1="${y(0.5)}" y2="${y(0)}" stroke="#75877c" stroke-dasharray="3 4"/>`);
    svg.push(`<circle cx="${x(model.median.time)}" cy="${y(0.5)}" r="5" fill="#20352f" stroke="white" stroke-width="2"/>`);
  }
  const labelCount = width < 550 ? 3 : 5;
  for (let index = 0; index < labelCount; index++) {
    const time = firstTime + (finalTime - firstTime) * index / (labelCount - 1);
    const anchor = index === 0 ? 'start' : index === labelCount - 1 ? 'end' : 'middle';
    const calendarDate = formatTime(time, { month: 'short', day: 'numeric', hour: undefined, minute: undefined });
    svg.push(`<text x="${x(time)}" y="${height - 22}" text-anchor="${anchor}" fill="#819088" font-size="10"><tspan x="${x(time)}">${escape(formatTime(time))}</tspan><tspan x="${x(time)}" dy="13">${escape(calendarDate)}</tspan></text>`);
  }
  svg.push('</svg>');
  $('chart').innerHTML = svg.join('');
  $('chart').onpointermove = event => {
    const rect = $('chart').querySelector('svg').getBoundingClientRect();
    // Default preserveAspectRatio centers the viewBox; account for letterboxing.
    const scale = Math.min(rect.width / width, rect.height / height);
    const offset = (rect.width - width * scale) / 2;
    const position = (event.clientX - rect.left - offset) / scale;
    const time = firstTime + (position - left) / (width - left - right) * (finalTime - firstTime);
    const row = model.rows.filter(row => row.fitted != null).reduce((previous, current) => Math.abs(current.t - time) < Math.abs(previous.t - time) ? current : previous);
    $('hover').textContent = row.result ? `${formatDate(row.t)} · Settled ${row.result.toUpperCase()} · ${percent(row.fitted)}` : `${formatDate(row.t)} · Fitted ${percent(row.fitted)} · Raw midpoint ${percent(row.raw)} · YES bid / ask ${percent(row.bid)} / ${percent(row.ask)}`;
  };
}
