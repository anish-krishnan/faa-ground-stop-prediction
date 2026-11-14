import { analyze, quantile } from './model.mjs';
import { drawChart } from './chart.mjs';

const $ = id => document.getElementById(id);
const HOUR = 3_600_000;
const REFRESH_MS = 10_000;
const state = { snapshot: null, model: null, busy: false, error: '', timer: null, backoff: 0 };
const percent = probability => probability == null ? '—' : `${(100 * probability).toFixed(1)}%`;
const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function format(time, options = {}) {
  if (time == null) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: $('timezone').value, hour: 'numeric', minute: '2-digit', ...options,
  }).format(new Date(time));
}
const date = time => format(time, { month: 'short', day: 'numeric', timeZoneName: 'short' });
function percentileLabel(result) {
  if (result?.time == null) return 'Unavailable';
  const qualifier = result.edge === 'after' ? 'After ' : result.edge === 'before' ? 'Before ' : '';
  return qualifier + date(result.time);
}

function renderStatus() {
  const { snapshot, model, error } = state;
  if (!snapshot) {
    $('status').textContent = error ? 'DATA UNAVAILABLE' : 'CONNECTING';
    $('status').className = `status ${error ? 'stale' : ''}`;
    return;
  }
  const age = (Date.now() - Date.parse(snapshot.fetchedAt)) / 1000;
  const stale = error || snapshot.stale || age > 90;
  $('status').textContent = stale ? 'STALE SNAPSHOT' : model?.settled ? 'SETTLED' : 'LIVE';
  $('status').className = `status ${stale ? 'stale' : 'live'}`;
  $('updated').textContent = `Kalshi · updated ${Math.max(0, Math.round(age))}s ago`;
}

function scheduleRefresh() {
  clearTimeout(state.timer);
  state.timer = setTimeout(load, Math.max(REFRESH_MS, state.backoff));
}

async function load() {
  if (state.busy) return;
  state.busy = true;
  try {
    const response = await fetch('/api/market', { cache: 'no-store', signal: AbortSignal.timeout(18_000) });
    const payload = await response.json();
    if (!response.ok || !payload.event || !Number.isFinite(Date.parse(payload.fetchedAt))) {
      throw new Error(payload.error || 'Invalid market snapshot');
    }
    state.snapshot = payload;
    state.error = payload.stale ? payload.error || 'Upstream data unavailable' : '';
    state.backoff = payload.stale ? Math.min(state.backoff ? state.backoff * 2 : 30_000, 120_000) : 0;
    render();
  } catch (error) {
    state.error = error.message || 'Unable to reach live data';
    state.backoff = Math.min(state.backoff ? state.backoff * 2 : 30_000, 120_000);
    $('notice').hidden = false;
    $('notice').textContent = `${state.snapshot ? 'Showing the last successful snapshot.' : 'No live prices received yet.'} ${state.error}. Retrying automatically.`;
  } finally {
    state.busy = false;
    renderStatus();
    scheduleRefresh();
  }
}

function renderMedian(result) {
  const value = format(result.time);
  $('median').classList.toggle('word', Boolean(result.edge));
  // Only local formatter output enters this markup. API text is never inserted unescaped.
  $('median').innerHTML = (result.edge ? 'After ' : '') + escape(value).replace(/ (AM|PM)$/, '<span class="period">$1</span>');
  $('medianDate').textContent = date(result.time);
}

function renderMathExample(model) {
  const index = model.points.findIndex(point => point.p >= 0.5);
  if (index < 1) {
    $('mathExample').textContent = 'The listed deadlines do not bracket 50%, so a precise median is unavailable.';
    return;
  }
  const a = model.points[index - 1];
  const b = model.points[index];
  const fraction = (0.5 - a.p) / (b.p - a.p);
  $('mathExample').textContent = `This snapshot: ${percent(a.p)} at ${date(a.t)}, and ${percent(b.p)} at ${date(b.t)}. The 50% crossing is ${(fraction * 100).toFixed(0)}% of the way between those times: approximately ${date(model.median.time)}.`;
}

function renderRows(model) {
  const fetchedAt = Date.parse(state.snapshot.fetchedAt);
  $('rows').innerHTML = model.rows.map(row => {
    const status = row.result ? `Settled ${row.result.toUpperCase()}` : row.t <= fetchedAt ? 'Past cutoff' : row.issue || row.status || 'Unknown';
    return `<tr><td>${escape(date(row.t))}</td><td>${percent(row.bid)}</td><td>${percent(row.ask)}</td><td>${percent(row.raw)}</td><td>${percent(row.fitted)}</td><td>${escape(status)}</td></tr>`;
  }).join('');
  const volume = model.rows.reduce((total, row) => total + row.volume, 0);
  $('volume').textContent = `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(volume)} contracts traded`;
}

function renderUnavailable(model) {
  $('median').textContent = model.settled ? 'Announced' : 'Unavailable';
  $('median').classList.add('word');
  $('medianDate').textContent = model.settled ? 'Qualifying outcome confirmed by Kalshi' : 'Insufficient usable future quotes';
  $('range').textContent = model.settled ? (model.earliest ? `${date(model.earliest)} – ` : 'Before ') + date(model.latest) : '—';
  $('rangeLabel').textContent = model.settled ? 'SETTLEMENT-IMPLIED WINDOW' : 'FORECAST UNAVAILABLE';
  $('rangeSub').textContent = model.settled ? 'Latest NO cutoff to earliest YES cutoff' : 'Awaiting usable market data';
  for (const id of ['mean', 'tail', 'quoteRange']) $(id).textContent = '—';
  $('meanDate').textContent = 'Forward forecast unavailable';
  $('tailDate').textContent = 'Chance beyond the final deadline';
  $('countdown').textContent = '';
  $('chart').innerHTML = `<div class="empty">${model.settled ? 'The market has resolved. See deadline outcomes below.' : 'Not enough quotes to draw a probability curve.'}</div>`;
  $('chart').onpointermove = null;
  $('quality').textContent = 'Forward curve unavailable';
  $('hover').textContent = '';
  $('mathExample').textContent = 'A forward worked example is unavailable for this snapshot.';
}

function render() {
  if (!state.snapshot) return;
  const model = analyze(state.snapshot, Date.parse(state.snapshot.fetchedAt));
  state.model = model;
  const notices = [];
  if (state.error) notices.push(`Showing a stale snapshot: ${state.error}.`);
  if (model.settled) notices.push('Kalshi has settled at least one deadline YES. The window below is established by settled contracts, not an exact FAA timestamp.');
  if (model.error) notices.push(model.error);
  $('notice').hidden = !notices.length;
  $('notice').textContent = notices.join(' ');
  renderRows(model);
  if (model.settled || model.error) {
    renderUnavailable(model);
    renderStatus();
    return;
  }
  const coverage = Number($('coverage').value);
  const low = quantile(model.points, (1 - coverage) / 2);
  const high = quantile(model.points, (1 + coverage) / 2);
  renderMedian(model.median);
  const wait = (model.median.time - Date.parse(state.snapshot.fetchedAt)) / HOUR;
  $('countdown').textContent = `${model.median.edge ? 'More than' : 'In about'} ${wait.toFixed(1)} hours`;
  $('rangeLabel').textContent = `${Math.round(coverage * 100)}% market-implied range`;
  $('range').textContent = `${percentileLabel(low)} – ${percentileLabel(high)}`;
  $('rangeSub').textContent = high.edge === 'after' ? 'Upper endpoint exceeds the listed deadlines.' : '';
  $('tail').textContent = percent(model.tail);
  $('tailDate').textContent = `Announcement after ${date(model.last)}`;
  const mean = model.restricted + model.tail * Number($('tailHours').value) * HOUR;
  $('mean').textContent = format(mean);
  $('meanDate').textContent = `${date(mean)} · assumed tail: +${$('tailHours').value}h`;
  $('quoteRange').textContent = `${percentileLabel(model.quoteEarly)} – ${percentileLabel(model.quoteLate)}`;
  $('quality').textContent = `${model.points.length - 1} usable contracts · ${model.excluded} excluded · max fit adjustment ${(100 * model.adjustment).toFixed(1)} pp`;
  drawChart(model, low, high, date, format);
  renderMathExample(model);
  renderStatus();
}

const dialog = $('mathDialog');
$('openMath').addEventListener('click', () => {
  dialog.showModal();
  document.body.classList.add('modal-open');
});
$('closeMath').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  document.body.classList.remove('modal-open');
  $('openMath').focus();
});
dialog.addEventListener('click', event => {
  const box = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
});
for (const id of ['timezone', 'coverage', 'tailHours', 'band']) $(id).addEventListener('change', render);
setInterval(renderStatus, 1000);
load();

let resizeFrame;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(render);
});
