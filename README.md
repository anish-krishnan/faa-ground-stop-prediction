# FAA Ground Stop Prediction

A Vercel-ready, read-only dashboard for the FAA lifting-announcement market `KXFAAGROUNDSTOPLIFT-13NOV26`. Large median ETA, selectable market-implied ranges, quote-spread bands, and an accessible math explainer with a live worked example. The homepage contains only the ETA, curve, and market data; mean and tail controls live inside the explainer.

## Local development

Node 22 is the deployment target. No third-party packages or API key are required.

```sh
npm run dev
# http://127.0.0.1:8766
npm test
npm run check
npm run build
```

Without npm, use `node dev.mjs`, `node --test test/*.test.mjs`, and `node build.mjs`. Source assets are read on every request; refresh the page after frontend edits. The local server runs the same API handler as Vercel. Set `PORT` to change the default port.

## Deploy to Vercel when ready

1. Push this directory to a Git repository and import it into Vercel (or run `vercel` here with the Vercel CLI).
2. Set the project root to `ground-stop-live` if importing its parent repository.
3. Use **Other** as the framework preset. `vercel.json` supplies `npm run build`, the `public` output directory, a 20-second function limit, and security headers.
4. Use Node **22.x**. No environment variables, credentials, database, cron job, or WebSocket connection are required.
5. Verify `/api/market` returns the expected event, `fetchedAt`, and `stale: false`; then check the ETA, timezone selector, math dialog, and mobile layout.

Deployment has not been performed. Public REST snapshots can lag the exchange. The homepage refreshes automatically 10 seconds after each completed request, with exponential backoff on errors; it is not an unattended history collector. A private deployment can be protected using Vercel's project access controls.

## Architecture

- `src/ui.html`, `src/style.css`: semantic markup and responsive ETA-first interface.
- `src/client.js`: frontend state, polling, rendering, native dialog lifecycle.
- `src/chart.mjs`: SVG probability visualization.
- `src/model.mjs`: pure pricing, immutable deadlines, isotonic fitting, quantiles, and survival integration.
- `server/kalshi.mjs`: fixed read-only upstream endpoint, timeout, validation, ten-second cache, request deduplication, and error backoff. Fetch and clock are injectable for isolated tests.
- `api/market.mjs`: Vercel Web Standard function adapter. No trading, portfolio, or arbitrary proxy endpoints.
- `dev.mjs`: local HTTP adapter using the production function.
- `build.mjs`: deterministic copying of browser assets only into `public/`; server files are never placed in the static output.
- `test/`: numerical and API behavior tests without live network access.

The API cache and last-success fallback are per warm serverless instance, not durable or globally shared. A cold instance with an upstream failure returns 502. Browsers retain their own last successful snapshot and clearly mark failures stale. Shared durable storage is not needed for this single-event dashboard; add it if historical time series or global rate limiting become requirements.

## Math and scope

Contracts are cumulative `P(T < deadline)` conditions, not mutually exclusive buckets. The model uses YES bid/ask midpoints and fits a nondecreasing CDF with inverse-squared spread weights (2 percentage-point floor). Deadline parsing is deliberately scoped to this November 2026 EST event; it does not use mutable early-close timestamps. Missing, crossed, inactive, and expired quotes, and spreads of 98 percentage points or wider, are excluded.

The curve is anchored at 0% at retrieval time, conditional on no qualifying announcement yet. Quantiles use linear interpolation. The central 50/80/90% intervals use the 25–75/10–90/5–95 percentiles. If the upper percentile is outside the observed contracts, it remains open-ended. Bid/ask bands are quote-sensitivity measures, not statistical confidence intervals. The mean integrates the survival curve and adds tail probability times a user-selected average additional wait beyond the last cutoff. A settled YES switches to the window between the latest preceding NO and earliest YES, without inventing an exact announcement time.

The event resolves on the FAA's official nationwide lifting announcement, not a future plan, a regional exception, or a particular flight's departure.

## References

- https://docs.kalshi.com/getting_started/quick_start_market_data
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/project-configuration/vercel-json
