/** Read-only Kalshi adapter. State is best-effort per warm serverless instance. */
export const EVENT_TICKER = 'KXFAAGROUNDSTOPLIFT-13NOV26';
export const UPSTREAM_URL = `https://external-api.kalshi.com/trade-api/v2/events/${EVENT_TICKER}?with_nested_markets=true`;
const CACHE_TTL_MS = 10_000;
const RETRY_DELAY_MS = 15_000;

export function createMarketService({ fetchImpl = fetch, now = Date.now } = {}) {
  let cached = null;
  let pending = null;
  let retryAt = 0;
  let lastError = '';

  async function refresh() {
    const response = await fetchImpl(UPSTREAM_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Kalshi returned HTTP ${response.status}`);
    const payload = await response.json();
    const markets = payload.event?.markets?.length ? payload.event.markets : payload.markets;
    if (payload.event?.event_ticker !== EVENT_TICKER || !Array.isArray(markets) || !markets.length) {
      throw new Error('Kalshi returned an invalid event snapshot');
    }
    cached = { ...payload, fetchedAt: new Date(now()).toISOString(), source: UPSTREAM_URL };
    retryAt = 0;
    lastError = '';
    return { ...cached, stale: false };
  }

  function failedSnapshot() {
    if (cached) return { ...cached, stale: true, error: lastError };
    throw new Error(lastError);
  }

  return {
    async getSnapshot() {
      if (cached && now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
        return { ...cached, stale: false };
      }
      if (now() < retryAt) return failedSnapshot();
      // Share a request across concurrent callers; never stamp cached data as newly fetched.
      if (!pending) {
        pending = refresh().catch(error => {
          lastError = error.name === 'TimeoutError' ? 'Kalshi request timed out' : error.message;
          retryAt = now() + RETRY_DELAY_MS;
          return failedSnapshot();
        }).finally(() => { pending = null; });
      }
      return pending;
    },
  };
}
