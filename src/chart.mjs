import { densityIntervals } from './model.mjs';
const $ = id => document.getElementById(id);
const percent = probability => `${(100 * probability).toFixed(1)}%`;
const escape = text => String(text).replace(/[&<>"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[character]));
const rawPoints = model => model.rows.filter(row => row.fitted != null)
  .map(row => ({ t: row.t, p: row.result ? row.fitted : row.raw }));

export function drawChart(model, low, high, formatDate, formatTime, raw = false) {
  const container = $(raw ? 'rawChart' : 'chart');
  const detail = $(raw ? 'rawHover' : 'hover');
  const width = Math.max(280, container.clientWidth);
  const height = Math.max(220, container.clientHeight);
  // Both panels use the same eligible inputs and axes. Only the quote values
  // change: unadjusted midpoints below, isotonic probabilities above.
  const rows = model.rows.filter(row => row.fitted != null);
  const points = rawPoints(model);
  const color = raw ? '#527b91' : '#df7136';
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
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${raw ? 'Raw quote midpoints by announcement deadline, before monotonic fitting' : 'Fitted cumulative probability by announcement deadline'}">`,
    ...(!raw && !low.edge && !high.edge ? [`<rect x="${x(low.time)}" y="${top}" width="${Math.max(0, x(high.time) - x(low.time))}" height="${height - top - bottom}" fill="#eaf0eb"/>`] : []),
  ];
  for (let p = 0; p <= 1; p += 0.25) {
    svg.push(`<line x1="${left}" y1="${y(p)}" x2="${width - right}" y2="${y(p)}" stroke="#e5eae5" stroke-dasharray="${p === 0.5 ? '4 4' : '0'}"/>`);
    svg.push(`<text x="${left - 12}" y="${y(p) + 4}" text-anchor="end" fill="#819088" font-size="10">${p * 100}%</text>`);
  }
  if (!raw && $('band').checked) {
    const lowerEdge = model.points.slice().reverse().map(point => `L${x(point.t)},${y(point.low)}`).join(' ');
    svg.push(`<path d="${path(model.points, 'high')} ${lowerEdge} Z" fill="#e46d32" fill-opacity=".14"/>`);
  }
  svg.push(`<path d="${path(raw ? points : model.points, 'p')}" stroke="${color}" stroke-width="2.7" fill="none"/>`);
  const drops = points.slice(1).flatMap((point, i) => point.p < points[i].p - 1e-12 ? [[points[i], point]] : []);
  if (raw) {
    for (const pair of drops) svg.push(`<path d="${path(pair, 'p')}" stroke="#b85450" stroke-width="3" fill="none"/>`);
    const largest = Math.max(0, ...drops.map(([a,b]) => a.p-b.p));
    $('rawQuality').textContent = drops.length ? `${drops.length} downward ${drops.length === 1 ? 'step' : 'steps'} · largest drop ${(largest*100).toFixed(1)} pp` : 'No downward steps in this snapshot';
  }
  const quotedRows = rows.filter(row => !row.result);
  for (const row of quotedRows) {
    if (raw && $('band').checked) {
      svg.push(`<path d="M${x(row.t)},${y(row.bid)} V${y(row.ask)} M${x(row.t)-3},${y(row.bid)} h6 M${x(row.t)-3},${y(row.ask)} h6" stroke="${color}" stroke-opacity=".35" fill="none"/>`);
    }
    svg.push(`<circle cx="${x(row.t)}" cy="${y(row.raw)}" r="3" stroke="${color}" fill="white"><title>${escape(formatDate(row.t))} · midpoint ${percent(row.raw)} · bid ${percent(row.bid)} / ask ${percent(row.ask)}</title></circle>`);
  }
  for (const point of model.points.filter(point => point.result)) {
    svg.push(`<rect x="${x(point.t)-3}" y="${y(point.p)-3}" width="6" height="6" fill="#2f855c"><title>${escape(formatDate(point.t))} · settled ${point.result.toUpperCase()} · ${percent(point.p)}</title></rect>`);
  }
  if (!raw && !model.median.edge) {
    svg.push(`<line x1="${x(model.median.time)}" x2="${x(model.median.time)}" y1="${y(0.5)}" y2="${y(0)}" stroke="#75877c" stroke-dasharray="3 4"/>`);
    svg.push(`<circle cx="${x(model.median.time)}" cy="${y(0.5)}" r="5" fill="#20352f" stroke="white" stroke-width="2"/>`);
  }
  svg.push('<line data-deadline-cursor visibility="hidden" stroke="#88988d" stroke-dasharray="2 4"/>');
  const labelCount = width < 550 ? 3 : 5;
  for (let index = 0; index < labelCount; index++) {
    const time = firstTime + (finalTime - firstTime) * index / (labelCount - 1);
    const anchor = index === 0 ? 'start' : index === labelCount - 1 ? 'end' : 'middle';
    const calendarDate = formatTime(time, { month: 'short', day: 'numeric', hour: undefined, minute: undefined });
    svg.push(`<text x="${x(time)}" y="${height - 22}" text-anchor="${anchor}" fill="#819088" font-size="10"><tspan x="${x(time)}">${escape(formatTime(time))}</tspan><tspan x="${x(time)}" dy="13">${escape(calendarDate)}</tspan></text>`);
  }
  svg.push('</svg>');
  container.innerHTML = svg.join('');
  detail.textContent = '';
  let selected = -1;
  function inspect(index) {
    selected = index;
    const row = rows[index];
    const cursor = container.querySelector('[data-deadline-cursor]');
    cursor.setAttribute('visibility', 'visible');
    cursor.setAttribute('x1', x(row.t)); cursor.setAttribute('x2', x(row.t));
    cursor.setAttribute('y1', top); cursor.setAttribute('y2', height-bottom);
    const adjustment = (row.fitted-row.raw)*100;
    detail.textContent = row.result ? `${formatDate(row.t)} · Settled ${row.result.toUpperCase()} · ${percent(row.fitted)} (known at this snapshot)` : `${formatDate(row.t)} · Raw ${percent(row.raw)} → fitted ${percent(row.fitted)} · adjustment ${adjustment >= 0 ? '+' : ''}${adjustment.toFixed(1)} pp · YES bid / ask ${percent(row.bid)} / ${percent(row.ask)}`;
  }
  container.onpointermove = event => {
    const rect = container.querySelector('svg').getBoundingClientRect();
    // Default preserveAspectRatio centers the viewBox; account for letterboxing.
    const scale = Math.min(rect.width / width, rect.height / height);
    const offset = (rect.width - width * scale) / 2;
    const position = (event.clientX - rect.left - offset) / scale;
    const time = firstTime + (position - left) / (width - left - right) * (finalTime - firstTime);
    inspect(rows.reduce((best, row, i) => Math.abs(row.t-time) < Math.abs(rows[best].t-time) ? i : best, 0));
  };
  container.onpointerdown = container.onpointermove;
  container.onkeydown = event => {
    const keys = { ArrowLeft: selected-1, ArrowRight: selected+1, Home: 0, End: rows.length-1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    inspect(Math.max(0, Math.min(rows.length-1, keys[event.key])));
  };
}

export function drawDensity(model, formatDate, formatTime, raw = false) {
  const container = $(raw ? 'rawDensity' : 'density');
  const detail = $(raw ? 'rawDensityHover' : 'densityHover');
  const quality = $(raw ? 'rawDensityQuality' : 'densityQuality');
  const fitted = densityIntervals(model.points);
  const original = densityIntervals(rawPoints(model));
  const intervals = raw ? original : fitted;
  container.onpointermove = container.onpointerdown = container.onkeydown = null;
  detail.textContent = ''; quality.textContent = '';
  if (!intervals.length) {
    container.innerHTML = '<div class="empty">Two supported deadlines are needed for a density.</div>';
    return;
  }
  const width = Math.max(280, container.clientWidth), height = Math.max(220, container.clientHeight);
  const left = 48, right = 22, top = 24, bottom = 42;
  const first = model.points[0].t, last = model.last;
  const x = t => left+(t-first)/(last-first)*(width-left-right);
  // Shared density scale, including raw negative slopes, for honest comparison.
  const values = [...fitted, ...original].map(p => p.perHour);
  const min = Math.min(0, ...values.filter(v=>Math.abs(v)>1e-12)), max = Math.max(.01, ...values);
  const target = (max-min)/4, magnitude = 10**Math.floor(Math.log10(target));
  const step = [1,2,5,10].find(n => n*magnitude >= target)*magnitude;
  const lower = Math.floor(min/step)*step, upper = Math.ceil(max/step)*step;
  const y = value => top+(upper-value)/(upper-lower)*(height-top-bottom);
  const color = raw ? '#527b91' : '#df7136';
  const rate = n => `${(n*100).toFixed(1)}% / h`;
  const svg = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${raw ? 'Raw CDF derivative; negative regions are invalid probability density' : 'Market-implied probability density per hour, derived from the fitted CDF'}">`,
    `<text x="${left}" y="12" fill="#819088" font-size="9">DENSITY (% / HOUR)</text>`];
  const yTicks = Array.from({length:Math.round((upper-lower)/step)+1},(_,i)=>lower+i*step);
  for (const value of yTicks) {
    svg.push(`<line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}" stroke="#e5eae5"/>`);
    svg.push(`<text x="${left-9}" y="${y(value)+4}" text-anchor="end" fill="#819088" font-size="10">${Number((value*100).toFixed(2))}%</text>`);
  }
  for (const interval of intervals) {
    const negative = interval.perHour < -1e-12;
    const stroke = negative ? '#b85450' : color;
    svg.push(`<rect x="${x(interval.start)}" y="${Math.min(y(0),y(interval.perHour))}" width="${x(interval.end)-x(interval.start)}" height="${Math.abs(y(interval.perHour)-y(0))}" fill="${stroke}" fill-opacity=".18"/>`);
    svg.push(`<path d="M${x(interval.start)},${y(0)} V${y(interval.perHour)} H${x(interval.end)} V${y(0)}" stroke="${stroke}" stroke-width="1.5" fill="none"/>`);
  }
  svg.push(`<line x1="${left}" x2="${width-right}" y1="${y(0)}" y2="${y(0)}" stroke="#819088"/>`);
  svg.push(`<rect data-interval-highlight visibility="hidden" y="${top}" height="${height-top-bottom}" fill="#243b33" fill-opacity=".06"/>`);
  const ticks = width < 550 ? 3 : 5;
  for (let i=0; i<ticks; i++) {
    const t = first+(last-first)*i/(ticks-1);
    const anchor = i===0 ? 'start' : i===ticks-1 ? 'end' : 'middle';
    const day = formatTime(t,{month:'short',day:'numeric',hour:undefined,minute:undefined});
    svg.push(`<text x="${x(t)}" y="${height-22}" text-anchor="${anchor}" fill="#819088" font-size="10"><tspan x="${x(t)}">${escape(formatTime(t))}</tspan><tspan x="${x(t)}" dy="13">${escape(day)}</tspan></text>`);
  }
  svg.push('</svg>'); container.innerHTML = svg.join('');
  const mass = intervals.reduce((sum,p)=>sum+p.mass,0);
  const negatives = intervals.filter(p=>p.perHour < -1e-12).length;
  quality.textContent = raw ? `${negatives} negative ${negatives===1?'interval':'intervals'}` : `Probability in range ${percent(mass)} · ${percent(1-mass)} outside`;
  detail.textContent = '';
  let selected = -1;
  function inspect(index) {
    selected = index;
    const p = intervals[index];
    const highlight = container.querySelector('[data-interval-highlight]');
    highlight.setAttribute('visibility','visible'); highlight.setAttribute('x',x(p.start));
    highlight.setAttribute('width',x(p.end)-x(p.start));
    detail.textContent = `${formatDate(p.start)} – ${formatDate(p.end)} · ${rate(p.perHour)} · ${raw ? 'CDF change' : 'Probability'} ${raw ? `${(p.mass*100).toFixed(1)} pp` : percent(p.mass)}${p.perHour < -1e-12 ? ' · invalid negative density' : ''}`;
  }
  container.onpointermove = event => {
    const rect = container.querySelector('svg').getBoundingClientRect();
    const scale = Math.min(rect.width/width,rect.height/height);
    const offset = (rect.width-width*scale)/2;
    const time = first+((event.clientX-rect.left-offset)/scale-left)/(width-left-right)*(last-first);
    const index = intervals.findIndex(p=>time<p.end);
    inspect(index<0 ? intervals.length-1 : index);
  };
  container.onpointerdown = container.onpointermove;
  container.onkeydown = event => {
    const keys = {ArrowLeft:selected-1,ArrowRight:selected+1,Home:0,End:intervals.length-1};
    if (!(event.key in keys)) return;
    event.preventDefault(); inspect(Math.max(0,Math.min(intervals.length-1,keys[event.key])));
  };
}
