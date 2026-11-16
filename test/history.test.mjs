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
test('unopened contracts are hidden; closed contracts remain visible without an assumed outcome', () => {
  const archive = {markets: [{...markets[0],open:start+1},{...markets[1],close:start}, markets[2]]};
  const snapshot = snapshotAt(archive,{at:start,quotes:[[0,.1,.2],[1,.2,.3],[2,.3,.4]]});
  assert.deepEqual(snapshot.event.markets.map(m=>m.ticker),[markets[1].ticker,markets[2].ticker]);
  const result=analyze(snapshot);
  assert.equal(result.rows[0].status,'closed'); assert.equal(result.rows[0].result,'');
  assert.equal(result.rows[0].fitted,undefined); assert.equal(result.quoteCount,1);
});
test('overlapping pagination deduplicates identical candles and rejects conflicting data', () => {
  assert.deepEqual(buildFrames(markets,[page,page],{start,endExclusive:start+60000}), buildFrames(markets,[page],{start,endExclusive:start+60000}));
  const altered = structuredClone(page); altered.market_candlesticks[0][0].yes_bid.close_dollars='.9';
  assert.throws(()=>buildFrames(markets,[page,altered],{start,endExclusive:start+60000}), /Conflicting/);
});
test('archive preserves forecasts and separates the subsequent reaction', async () => {
  const archive = JSON.parse(await readFile(new URL('../data/history.json',import.meta.url)));
  const history = historyModels(archive);
  assert.equal(history.length,216);
  assert.equal(history.filter(p=>!p.model.error).length,208);
  for (let i=0;i<history.length;i++) {
    assert.ok(history[i].at < archive.endExclusive);
    if(i) assert.equal(history[i].at-history[i-1].at,60000);
    assert.ok(!history[i].model.settled);
  }
  const first = history.find(p=>!p.model.error);
  assert.equal(quantile(first.model.points,.9).edge,'after');
  const lastForecast = history.findLast(p => !p.reaction);
  assert.ok(first.model.median.time < lastForecast.model.median.time);
  // Independent check from the audited 49% / 54.5% closing midpoints.
  const expected = Date.parse('2026-11-14T09:30:00Z') + (0.50-0.49)/(0.545-0.49)*1800000;
  assert.ok(Math.abs(lastForecast.model.median.time-expected) < 1);
  assert.ok(history.at(-1).model.median.time < history.at(-1).at);
  assert.ok(history.at(-1).model.median.time > Date.parse('2026-11-14T01:00:00Z'));
  assert.equal(archive.settlement.earliest, Date.parse('2026-11-14T01:00:00Z'));
  assert.equal(archive.settlement.latest, Date.parse('2026-11-14T01:30:00Z'));
});

test('reopening is a presentation label: moving it cannot change any estimate', async () => {
  const archive = JSON.parse(await readFile(new URL('../data/history.json',import.meta.url)));
  const original=historyModels(archive);
  const relabeled=historyModels({...archive,reference:{at:archive.start-60000}});
  assert.deepEqual(original.map(p=>p.model),relabeled.map(p=>p.model));
});

test('settlements enter at their recorded timestamp, for NO and YES alike', () => {
  const archive={markets:markets.map((m,i)=>({...m,close:start+30000,result:i===0?'no':'yes',settledAt:start+60000})),reference:{at:start},frames:[
    {at:start,quotes:[[0,.1,.2],[1,.6,.7],[2,.8,.9]]},
    {at:start+30000,quotes:[]},
    {at:start+60000,quotes:[]},
  ]};
  const history=historyModels(archive);
  assert.equal(history[0].model.settlementCount,0);
  assert.ok(history[1].model.error);
  assert.deepEqual(history[2].model.points.map(p=>p.p),[0,1,1]);
  assert.equal(history[2].model.settlementCount,3);
  assert.deepEqual(snapshotAt(archive,archive.frames[2]).event.markets.map(m=>m.result),['no','yes','yes']);
  const future=structuredClone(archive); future.markets.forEach(m=>m.settledAt+=60000);
  assert.deepEqual(historyModels(future)[0].model,history[0].model);
  assert.ok(historyModels(future)[2].model.error);
});

test('stale quotes stay visible but do not enter the fit, and future quotes cannot leak back', () => {
  const archive={markets,reference:{at:start},frames:[
    {at:start,quotes:[[0,.1,.2],[1,.6,.7],[2,.8,.9]]},
    {at:start+60000,quotes:[[1,.7,.8]]},
    {at:start+120000,quotes:[[0,.4,.5]]},
  ]};
  const model=historyModels(archive)[1].model;
  assert.equal(model.quoteCount,1); assert.equal(model.rows[0].stale,true);
  assert.equal(model.rows[0].quotedAt,start); assert.equal(model.rows[0].bid,.1);
  assert.equal(model.rows[0].fitted,undefined);
  assert.deepEqual(analyze(snapshotAt(archive,archive.frames[1])),model);
});

test('post-close candle placeholders do not overwrite the last trading quote', () => {
  const archive={markets:[{...markets[0],close:start+60000}],reference:{at:start},frames:[
    {at:start,quotes:[[0,.1,.2]]}, {at:start+60000,quotes:[[0,.01,.02]]},
    {at:start+120000,quotes:[[0,0,0]]},
  ]};
  const last=historyModels(archive).at(-1).model.rows[0];
  assert.equal(last.bid,.01); assert.equal(last.quotedAt,start+60000); assert.equal(last.stale,true);
  assert.equal(last.result,''); assert.equal(last.fitted,undefined);
});
