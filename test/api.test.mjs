import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketService, EVENT_TICKER } from '../server/kalshi.mjs';
import { createMarketHandler } from '../api/market.mjs';

const payload = () => ({ event: { event_ticker: EVENT_TICKER, markets: [{ ticker: `${EVENT_TICKER}-14NOV260000` }] } });
const request = () => new Request('https://example.test/api/market');

test('cache preserves retrieval time and expires after ten seconds', async () => {
  let time = 100_000, calls = 0;
  const service = createMarketService({ now: () => time, fetchImpl: async () => { calls++; return Response.json(payload()); } });
  const first = await service.getSnapshot();
  time += 9_000;
  assert.equal((await service.getSnapshot()).fetchedAt, first.fetchedAt);
  assert.equal(calls, 1);
  time += 2_000;
  assert.notEqual((await service.getSnapshot()).fetchedAt, first.fetchedAt);
  assert.equal(calls, 2);
});

test('concurrent requests share one upstream fetch', async () => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createMarketService({ fetchImpl: async () => { calls++; await gate; return Response.json(payload()); } });
  const pending = [service.getSnapshot(), service.getSnapshot()];
  release();
  const [a, b] = await Promise.all(pending);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});

test('failure retains old timestamp, marks stale and backs off', async () => {
  let time = 100_000, fail = false, calls = 0;
  const service = createMarketService({ now: () => time, fetchImpl: async () => {
    calls++;
    return fail ? new Response('Unavailable', { status: 503 }) : Response.json(payload());
  } });
  const first = await service.getSnapshot();
  fail = true; time += 11_000;
  const stale = await service.getSnapshot();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.match(stale.error, /503/);
  await service.getSnapshot();
  assert.equal(calls, 2);
  fail = false; time += 16_000;
  assert.equal((await service.getSnapshot()).stale, false);
});

test('cold-start failure returns 502 with retry information', async () => {
  const handler = createMarketHandler(createMarketService({ fetchImpl: async () => new Response('', { status: 429 }) }));
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Retry-After'), '15');
  assert.match((await response.json()).error, /429/);
});

test('unexpected event cannot be presented as this market', async () => {
  const handler = createMarketHandler(createMarketService({ fetchImpl: async () => Response.json({ event: { event_ticker: 'WRONG', markets: [{}] } }) }));
  assert.equal((await handler(request())).status, 502);
});

test('only GET is supported and snapshots are never browser-cached', async () => {
  let calls = 0;
  const handler = createMarketHandler({ getSnapshot: async () => { calls++; return payload(); } });
  const rejected = await handler(new Request('https://example.test/api/market', { method: 'POST' }));
  assert.equal(rejected.status, 405);
  assert.equal(calls, 0);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
