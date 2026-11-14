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
    volume: Number(market.volume_fp ?? market.volume ?? 0),
    issue,
    last: price(market, 'last_price'),
  };
}

export function analyze(data, now = Date.now()) {
  const markets = data.event?.markets?.length ? data.event.markets : data.markets || [];
  const rows = markets.map(quoteRow).filter(row => Number.isFinite(row.t)).sort((a, b) => a.t - b.t);
  const yes = rows.filter(row => row.result === 'yes');
  const no = rows.filter(row => row.result === 'no');
  if (yes.length) {
    return {
      rows, settled: true, points: [],
      earliest: no.filter(row => row.t < yes[0].t).at(-1)?.t ?? null,
      latest: yes[0].t,
    };
  }
  const usable = rows.filter(row => row.t > now && row.raw !== null && !row.result && ['active', 'open'].includes(row.status));
  if (usable.length < 2) {
    return { rows, points: [], error: 'Not enough future deadlines with two-sided quotes. The event may be closed or awaiting settlement.' };
  }
  const weights = usable.map(row => 1 / Math.max(0.02, row.ask - row.bid) ** 2);
  const fitted = isotonic(usable.map(row => row.raw), weights);
  const low = isotonic(usable.map(row => row.bid), weights);
  const high = isotonic(usable.map(row => row.ask), weights);
  // Conditional on the qualifying announcement not having occurred at snapshot time.
  const points = [
    { t: now, p: 0, low: 0, high: 0 },
    ...usable.map((row, index) => ({ t: row.t, p: fitted[index], low: low[index], high: high[index] })),
  ];
  usable.forEach((row, index) => { row.fitted = fitted[index]; });
  // E[min(T,L)] = now + integral(now..L) of (1 - F(t)); units are epoch milliseconds.
  let restricted = now;
  for (let index = 1; index < points.length; index++) {
    const left = points[index - 1];
    const right = points[index];
    restricted += (right.t - left.t) * (1 - (left.p + right.p) / 2);
  }
  return {
    rows, points,
    median: quantile(points, 0.5),
    quoteEarly: quantile(points, 0.5, 'high'),
    quoteLate: quantile(points, 0.5, 'low'),
    tail: 1 - points.at(-1).p,
    last: points.at(-1).t,
    restricted,
    adjustment: Math.max(...usable.map((row, index) => Math.abs(row.raw - fitted[index]))),
    excluded: rows.filter(row => row.t > now && row.issue).length,
  };
}
