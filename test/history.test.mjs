import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildFrames, historyModels, snapshotAt } from '../src/history.mjs';
import { analyze, EVENT, quantile } from '../src/model.mjs';

const start = Date.parse('2026-11-13T22:00:00Z');
const markets = [1800, 1900, 2000].map(hour => ({ ticker: `${EVENT}-13NOV26${hour}`, open: start, close: start + 10*3600000 }));
const candle = (at, bid, ask) => ({ end_period_ts: at/1000,
  yes_bid: {close_dollars:bid}, yes_ask: {close_dollars:ask} });
const page = { market_tickers: markets.map(m => m.ticker), market_candlesticks: [
  [candle(start, '.2', '.3'), candle(start+120000, '.8', '.9')],
  [candle(start, '.6', '.7')], [candle(start, null, '.9')],
] };

test('reconstruction uses exact-minute closes, preserves gaps, and excludes the end boundary', () => {
  const frames = buildFrames(markets, [page], { start, endExclusive:start+120000 });
  assert.deepEqual(frames, [{at:start, quotes:[[0,.2,.3],[1,.6,.7]]}, {at:start+60000,quotes:[]}]);
  assert.ok(analyze(snapshotAt({markets}, frames[0]), start).median);
  assert.ok(analyze(snapshotAt({markets}, frames[1]), start+60000).error);
});
test('later quotes and current settlement cannot change earlier forecasts', () => {
  const archive = {markets:markets.map(m=>({...m,result:'yes',status:'finalized',yes_bid_dollars:1}))};
  const frame = buildFrames(markets,[page],{start,endExclusive:start+180000})[0];
  const snapshot = snapshotAt(archive,frame);
  assert.ok(!analyze(snapshot,start).settled);
  assert.equal(snapshot.event.markets[0].result,'');
  assert.equal(snapshot.event.markets[0].yes_bid_dollars,.2);
});
test('unopened and closed contracts are excluded at observation time', () => {
  const archive = {markets: [{...markets[0],open:start+1},{...markets[1],close:start}, markets[2]]};
  assert.deepEqual(snapshotAt(archive,{at:start,quotes:[[0,.1,.2],[1,.2,.3],[2,.3,.4]]}).event.markets.map(m=>m.ticker),[markets[2].ticker]);
});
test('overlapping pagination deduplicates identical candles and rejects conflicting data', () => {
  assert.deepEqual(buildFrames(markets,[page,page],{start,endExclusive:start+60000}), buildFrames(markets,[page],{start,endExclusive:start+60000}));
  const altered = structuredClone(page); altered.market_candlesticks[0][0].yes_bid.close_dollars='.9';
  assert.throws(()=>buildFrames(markets,[page,altered],{start,endExclusive:start+60000}), /Conflicting/);
});
test('archive is ordered, pre-reopening, and retains unbounded percentiles', async () => {
  const archive = JSON.parse(await readFile(new URL('../data/history.json',import.meta.url)));
  const history = historyModels(archive);
  assert.equal(history.length,205);
  assert.equal(history.filter(p=>!p.model.error).length,197);
  for (let i=0;i<history.length;i++) {
    assert.ok(history[i].at < archive.reference.at);
    if(i) assert.equal(history[i].at-history[i-1].at,60000);
    assert.ok(!history[i].model.settled);
    if(!history[i].model.error) assert.ok(history[i].model.median.time >= history[i].at);
  }
  const first = history.find(p=>!p.model.error);
  assert.equal(quantile(first.model.points,.9).edge,'after');
  assert.ok(first.model.median.time < history.at(-1).model.median.time);
});
