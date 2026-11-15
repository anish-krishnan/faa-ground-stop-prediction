import { mkdir, copyFile, rm } from 'node:fs/promises';

// Only browser assets are public. API, tests, configuration, and source credentials stay server-side.
const assets = {
  'src/ui.html': 'index.html',
  'src/style.css': 'style.css',
  'src/client.js': 'client.js',
  'src/chart.mjs': 'chart.mjs',
  'src/model.mjs': 'model.mjs',
  'src/history.mjs': 'history.mjs',
  'src/history-chart.mjs': 'history-chart.mjs',
  'data/history.json': 'history.json',
};
await rm(new URL('./public/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('./public/', import.meta.url), { recursive: true });
for (const [source, target] of Object.entries(assets)) {
  await copyFile(new URL(source, import.meta.url), new URL(`public/${target}`, import.meta.url));
}
console.log('Built public/ for Vercel. API: api/market.mjs');
