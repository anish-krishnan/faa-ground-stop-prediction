import { analyze, EVENT } from './model.mjs';

/** Reconstruct only from this minute's closing quotes. No forward fill or settlement leakage. */
export function snapshotAt(archive, frame) {
  return {
    fetchedAt: new Date(frame.at).toISOString(),
    event: { event_ticker: EVENT, markets: frame.quotes.flatMap(([index, bid, ask]) => {
      const market = archive.markets[index];
      if (!market || market.open > frame.at || market.close <= frame.at) return [];
      return [{ ticker: market.ticker, status: 'active', result: '',
        yes_bid_dollars: bid, yes_ask_dollars: ask }];
    }) },
  };
}

export function historyModels(archive) {
  return archive.frames.map(frame => {
    const reaction = frame.at >= archive.reference.at;
    // Retrospective reaction estimates may put the event in the past. Anchor only
    // at a NO cutoff whose settlement was already public at this observation.
    // The eventual YES outcome and actual reopening time do not set the CDF value.
    const knownNo = (archive.noSettlements || [])
      .filter(s => s.knownAt <= frame.at && s.t <= frame.at && Number.isFinite(s.t))
      .reduce((latest, s) => Math.max(latest, s.t), -Infinity);
    const anchor = reaction ? knownNo : frame.at;
    const model = Number.isFinite(anchor)
      ? analyze(snapshotAt(archive, frame), anchor)
      : { rows: [], points: [], error: 'No previously settled NO cutoff for a retrospective estimate.' };
    return { at: frame.at, reaction, anchor, model };
  });
}

function closePrice(side) {
  const value = side?.close_dollars;
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

/** Event-candlestick responses use dollar fields. Keep their precision without trade-price fallback. */
export function buildFrames(markets, pages, { start, endExclusive }) {
  const marketIndex = new Map(markets.map((market, index) => [market.ticker, index]));
  const frames = new Map();
  for (const page of pages) {
    if (page.market_tickers?.length !== page.market_candlesticks?.length) throw new Error('Malformed candle page');
    page.market_tickers.forEach((ticker, i) => {
      const index = marketIndex.get(ticker);
      if (index === undefined) throw new Error(`Unknown contract: ${ticker}`);
      for (const candle of page.market_candlesticks[i]) {
        const at = Number(candle.end_period_ts) * 1000;
        if (!Number.isFinite(at) || at < start || at >= endExclusive) continue;
        const bid = closePrice(candle.yes_bid), ask = closePrice(candle.yes_ask);
        if (bid === null || ask === null) continue;
        if (!frames.has(at)) frames.set(at, new Map());
        const prior = frames.get(at).get(index);
        if (prior && (prior[1] !== bid || prior[2] !== ask)) throw new Error('Conflicting overlapping candles');
        frames.get(at).set(index, [index, bid, ask]);
      }
    });
  }
  // Retain empty minutes so the chart shows data gaps rather than joining across them.
  const result = [];
  for (let at = Math.ceil(start / 60000) * 60000; at < endExclusive; at += 60000) {
    result.push({ at, quotes: [...(frames.get(at)?.values() || [])].sort((a, b) => a[0] - b[0]) });
  }
  return result;
}
