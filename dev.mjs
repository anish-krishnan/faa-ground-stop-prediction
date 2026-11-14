import http from 'node:http';
import { readFile } from 'node:fs/promises';
import market from './api/market.mjs';

const assets = {
  '/': ['src/ui.html', 'text/html'],
  '/style.css': ['src/style.css', 'text/css'],
  '/client.js': ['src/client.js', 'text/javascript'],
  '/chart.mjs': ['src/chart.mjs', 'text/javascript'],
  '/model.mjs': ['src/model.mjs', 'text/javascript'],
};
const port = Number(process.env.PORT || 8766);
const server = http.createServer(async (req, res) => {
  try {
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method });
    const path = new URL(request.url).pathname;
    if (path === '/api/market') {
      const response = await market.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (req.method !== 'GET' || !assets[path]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const [file, type] = assets[path];
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(await readFile(new URL(file, import.meta.url)));
  } catch (error) {
    console.error(error.message);
    res.writeHead(500);
    res.end('Unable to serve this request');
  }
});
server.on('error', error => {
  console.error(`Cannot start local server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Ground Stop Live → http://127.0.0.1:${port}`));
