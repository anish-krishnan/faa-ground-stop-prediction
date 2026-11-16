import { analyze, EVENT } from './model.mjs';

/** Carry old quotes for display only. Fits use this minute's quotes and as-of settlements. */
export function snapshotAt(archive, frame, lastQuotes) {
  const remember = (quotes, observation) => {
    for (const [index, bid, ask] of observation.quotes) {
      const market = archive.markets[index];
      if (!market || observation.at < market.open || observation.at > market.close) continue;
      if (!quotes.has(index) || quotes.get(index).at <= observation.at) quotes.set(index, { bid, ask, at: observation.at });
    }
  };
  if (!lastQuotes) {
    lastQuotes = new Map();
    for (const prior of archive.frames || []) {
      if (prior.at > frame.at) continue;
      remember(lastQuotes, prior);
    }
  }
  remember(lastQuotes, frame);
  return {
    fetchedAt: new Date(frame.at).toISOString(),
    event: { event_ticker: EVENT, markets: archive.markets.flatMap((market, index) => {
      if (market.open > frame.at) return [];
      const quote = lastQuotes.get(index);
      const result = Number.isFinite(market.settledAt) && market.settledAt <= frame.at ? market.result : '';
      const closed = market.close <= frame.at;
      return [{ ticker: market.ticker, status: result ? 'finalized' : closed ? 'closed' : 'active', result,
        quotedAt: quote?.at ?? null, quoteStale: Boolean(quote && (quote.at !== frame.at || closed || result)),
        yes_bid_dollars: quote?.bid, yes_ask_dollars: quote?.ask }];
    }) },
  };
}

export function historyModels(archive) {
  const lastQuotes = new Map();
  return archive.frames.map(frame => {
    const reaction = frame.at >= archive.reference.at;
    // Reopening changes the line style only, never the estimation method.
    const model = analyze(snapshotAt(archive, frame, lastQuotes));
    return { at: frame.at, reaction, model };
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
