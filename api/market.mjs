import { createMarketService } from '../server/kalshi.mjs';

const service = createMarketService();

export function createMarketHandler(marketService = service) {
  return async function handle(request) {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
    }
    try {
      return Response.json(await marketService.getSnapshot(), {
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    } catch (error) {
      return Response.json({ error: error.message }, {
        status: 502,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '15' },
      });
    }
  };
}

// Vercel's native Web Standard handler; the local server uses this exact handler too.
export default { fetch: createMarketHandler() };
