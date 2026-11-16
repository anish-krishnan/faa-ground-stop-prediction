/** Pure forecast math. Prices are approximate probabilities, not calibrated confidence. */
export const EVENT = 'KXFAAGROUNDSTOPLIFT-13NOV26';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function price(market, key) {
  const dollars = market[`${key}_dollars`];
  const value = dollars !== undefined && dollars !== null && dollars !== ''
    ? Number(dollars)
    : market[key] !== undefined && market[key] !== null ? Number(market[key]) / 100 : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

export function deadline(market) {
  // Immutable contract cutoff, never the early-closing timestamp.
  const match = market.ticker?.match(/-(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return NaN;
  const [, day, month, year, hour, minute] = match;
  const monthIndex = MONTHS.indexOf(month);
  if (monthIndex < 0 || Number(hour) > 23 || Number(minute) > 59) return NaN;
  // This specific November 2026 event expresses all deadlines in EST (UTC-5).
  return Date.UTC(2000 + Number(year), monthIndex, Number(day), Number(hour) + 5, Number(minute));
}

/** Weighted pool-adjacent-violators algorithm; minimizes squared error under monotonicity. */
export function isotonic(values, weights = values.map(() => 1)) {
  const blocks = [];
  values.forEach((value, index) => {
    blocks.push({ sum: value * weights[index], weight: weights[index], count: 1 });
    while (blocks.length > 1) {
      const right = blocks.at(-1);
      const left = blocks.at(-2);
      if (left.sum / left.weight <= right.sum / right.weight) break;
      blocks.splice(-2, 2, {
        sum: left.sum + right.sum,
        weight: left.weight + right.weight,
        count: left.count + right.count,
      });
    }
  });
  return blocks.flatMap(block => Array(block.count).fill(block.sum / block.weight));
}

/** Linear interpolation, with explicit censoring outside the supported deadline range. */
export function quantile(points, probability, key = 'p') {
  for (let index = 0; index < points.length; index++) {
    if (points[index][key] < probability) continue;
    if (index === 0) return { time: points[index].t, edge: 'before' };
    const left = points[index - 1];
    const right = points[index];
    const difference = right[key] - left[key];
    return {
      time: difference > 0
        ? left.t + (right.t - left.t) * (probability - left[key]) / difference
        : right.t,
      edge: null,
    };
  }
  return { time: points.at(-1)?.t ?? null, edge: 'after' };
}

/** Derivative of the piecewise-linear curve, in probability per hour.
 * Preserve negative raw slopes. Do not normalize away unobserved tail mass. */
export function densityIntervals(points) {
  return points.slice(1).map((right, i) => {
    const left = points[i];
    const hours = (right.t-left.t)/3_600_000;
    if (!(hours > 0)) throw new Error('Density requires strictly increasing deadlines');
    const mass = right.p-left.p;
    return { start: left.t, end: right.t, mass, perHour: mass/hours };
  });
}

function quoteRow(market) {
  const noAsk = price(market, 'no_ask');
  const noBid = price(market, 'no_bid');
  const bid = price(market, 'yes_bid') ?? (noAsk === null ? null : 1 - noAsk);
  const ask = price(market, 'yes_ask') ?? (noBid === null ? null : 1 - noBid);
  let issue = null;
  if (bid === null || ask === null || ask <= 0 || bid >= 1) issue = 'Missing quote';
  else if (bid > ask) issue = 'Crossed quote';
  else if (ask - bid >= 0.98) issue = 'Spread ≥98pp';
  return {
    ticker: market.ticker,
    t: deadline(market), bid, ask,
    raw: issue ? null : (bid + ask) / 2,
    result: market.result || '',
    status: market.status,
    quotedAt: market.quotedAt ?? null,
    stale: Boolean(market.quoteStale),
    volume: Number(market.volume_fp ?? market.volume ?? 0),
    issue,
    last: price(market, 'last_price'),
  };
}

export function analyze(data) {
  const markets = data.event?.markets?.length ? data.event.markets : data.markets || [];
  const rows = markets.map(quoteRow).filter(row => Number.isFinite(row.t)).sort((a, b) => a.t - b.t);
  const yes = rows.filter(row => row.result === 'yes');
  const no = rows.filter(row => row.result === 'no');
  const earliest = no.at(-1)?.t ?? null;
  const latest = yes[0]?.t ?? null;
  const outcome = { settled: yes.length > 0, earliest, latest };
  if (earliest !== null && latest !== null && earliest >= latest) {
    return { rows, points: [], ...outcome, error: 'Conflicting settlement outcomes.' };
  }
  const usable = rows.filter(row => row.raw !== null && !row.result && !row.stale && ['active', 'open'].includes(row.status));
  const settlements = rows.filter(row => ['yes', 'no'].includes(row.result));
  if (!usable.length && !settlements.length) {
    return { rows, points: [], ...outcome, error: 'No usable two-sided quotes or known settlements at this minute.' };
  }
  // Settlements are hard constraints, not heavily weighted quotes. Monotonicity
  // forces all deadlines at/before a known NO to zero, and at/after a known YES to one.
  const fixed = row => row.result === 'no' || (earliest !== null && row.t <= earliest) ? 0
    : row.result === 'yes' || (latest !== null && row.t >= latest) ? 1 : null;
  const free = usable.filter(row => fixed(row) === null);
  const weights = free.map(row => 1 / Math.max(0.02, row.ask - row.bid) ** 2);
  const fitted = isotonic(free.map(row => row.raw), weights);
  const low = isotonic(free.map(row => row.bid), weights);
  const high = isotonic(free.map(row => row.ask), weights);
  const estimates = new Map(free.map((row, i) => [row, { p: fitted[i], low: low[i], high: high[i] }]));
  const points = [...usable, ...settlements].sort((a, b) => a.t - b.t).map(row => {
    const value = fixed(row);
    const fit = value === null ? estimates.get(row) : { p: value, low: value, high: value };
    row.fitted = fit.p;
    return { t: row.t, ...fit, result: row.result };
  });
  // A finite mean needs a supported zero-probability lower boundary. Otherwise
  // the unknown left tail makes even a restricted mean unidentified.
  let restricted = points[0].p === 0 ? points[0].t : null;
  for (let index = 1; index < points.length; index++) {
    const left = points[index - 1];
    const right = points[index];
    if (restricted !== null) restricted += (right.t - left.t) * (1 - (left.p + right.p) / 2);
  }
  return {
    rows, points, ...outcome,
    quoteCount: usable.length,
    settlementCount: settlements.length,
    median: quantile(points, 0.5),
    quoteEarly: quantile(points, 0.5, 'high'),
    quoteLate: quantile(points, 0.5, 'low'),
    tail: 1 - points.at(-1).p,
    last: points.at(-1).t,
    restricted,
    adjustment: Math.max(0, ...usable.map(row => Math.abs(row.raw - row.fitted))),
    excluded: rows.length - usable.length - settlements.length,
  };
}
