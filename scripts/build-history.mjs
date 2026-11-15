import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { buildFrames, historyModels } from '../src/history.mjs';
import { EVENT } from '../src/model.mjs';

const root = new URL('../', import.meta.url);
const inputs = ['event', 'candles-1', 'candles-2'];
const source = [];
const payloads = [];
for (const name of inputs) {
  const bytes = gunzipSync(await readFile(new URL(`data/source/${name}.json.gz`, root)));
  source.push({ file: `${name}.json.gz`, sha256: createHash('sha256').update(bytes).digest('hex') });
  payloads.push(JSON.parse(bytes));
}
const [event, ...pages] = payloads;
if (event.event.event_ticker !== EVENT) throw new Error('Unexpected event');
const start = Date.parse('2026-11-13T21:50:00Z');
const endExclusive = Date.parse('2026-11-14T01:15:00Z');
const markets = event.event.markets.map(m => ({
  ticker: m.ticker, open: Date.parse(m.open_time), close: Date.parse(m.close_time),
}));
const archive = {
  version: 1, eventTicker: EVENT, resolutionSeconds: 60, retrievedOn: '2026-11-15',
  source, start, endExclusive,
  reference: { at: endExclusive, label: 'Airspace reopened',
    url: 'https://rollcall.com/factbase/trump/transcript/donald-trump-press-briefing-markwayne-mullin-sean-duffy-faa-ground-stop-november-13-2026/' },
  advisory: { at: Date.parse('2026-11-14T01:19:00Z'),
    url: 'https://www.fly.faa.gov/ois/oisedit/adv_oisedit_dis?day=11142026&number=5' },
  markets, frames: buildFrames(markets, pages, { start, endExclusive }),
};
const models = historyModels(archive);
if (!models.some(p => !p.model.error)) throw new Error('No usable historical forecasts');
await writeFile(new URL('data/history.json', root), JSON.stringify(archive) + '\n');
console.log(`${models.filter(p => !p.model.error).length}/${models.length} minutes reconstructed; ${markets.length} contracts`);
