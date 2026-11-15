# FAA Ground Stop Prediction

A read-only dashboard for the FAA lifting-announcement market `KXFAAGROUNDSTOPLIFT-13NOV26`. Large median ETA, selectable market-implied ranges, quote-spread bands, and an accessible math explainer with a live worked example. The settled-event homepage replays historical estimates with a timeline, the selected minute’s probability curve, and its underlying quotes. Mean and tail controls live inside the explainer.

Live: https://faa-ground-stop-prediction.vercel.app

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

## Deployment

1. Push this directory to a Git repository and import it into Vercel (or run `vercel` here with the Vercel CLI).
2. Set the project root to `ground-stop-live` if importing its parent repository.
3. Use **Other** as the framework preset. `vercel.json` supplies `npm run build`, the `public` output directory, a 20-second function limit, and security headers.
4. Use Node **22.x**. No environment variables, credentials, database, cron job, or WebSocket connection are required.
5. Verify `/api/market` returns the expected event, `fetchedAt`, and `stale: false`; then check the ETA, timezone selector, math dialog, and mobile layout.

The project is deployed on Vercel, connected to the `main` branch of `anish-krishnan/faa-ground-stop-prediction`. Push local commits to deploy updates. The archive loads as a static asset and does not poll. If it fails to load, the original live dashboard remains available and refreshes 10 seconds after each completed request, with exponential backoff on errors. Public REST snapshots can lag the exchange.

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

The API cache and last-success fallback are per warm serverless instance, not durable or globally shared. A cold instance with an upstream failure returns 502. Browsers retain their own last successful snapshot and clearly mark failures stale. Historical data is a committed, immutable archive. No database or background collector is required for this resolved event.

## Historical archive

`data/history.json` contains minute-end closing bid/ask quotes and contract opening/closing times, not precomputed forecasts. `src/history.mjs` reuses the live model to reconstruct each minute. The slider selects one snapshot and updates the ETA, probability curve, and table together. Range and timezone settings apply to both charts. No final settlement outcome or present-day quote enters an earlier forecast.

- Observation window: November 13, 2026, 21:50 UTC through November 14, 01:14 UTC.
- 205 minute slots; 197 have at least two eligible, usable future deadlines. Missing minutes remain gaps.
- Only each minute’s own closing quotes are used. Missing quotes are omitted, with no carry-forward or interpolation across observation times. This can change coverage between minutes; estimates are reconstructions, not exact logs of previously displayed forecasts.
- The shaded range is omitted when either quantile is unbounded. Unbounded medians use upward markers at their known lower bound. No tail assumption is used to invent quantile endpoints.
- The horizontal reference is **airspace reopening at 01:15 UTC (8:15 p.m. EST)**, as reported by Secretary Duffy in the [press briefing transcript](https://rollcall.com/factbase/trump/transcript/donald-trump-press-briefing-markwayne-mullin-sean-duffy-faa-ground-stop-november-13-2026/). This is not claimed to be the exact qualifying-announcement timestamp. Kalshi outcomes imply 01:00 ≤ announcement < 01:30 UTC. The [FAA cancellation advisory](https://www.fly.faa.gov/ois/oisedit/adv_oisedit_dis?day=11142026&number=5) is signed 01:19 UTC. Reconstruction stops strictly before reopening.

### Reproduce

Run `npm run archive` to regenerate `data/history.json` deterministically from the gzipped public API responses in `data/source/`. The output records SHA-256 hashes of their uncompressed bytes. Raw responses were downloaded on November 15, 2026 without authentication. They are not included in the browser build.

The event endpoint was:

```
https://external-api.kalshi.com/trade-api/v2/events/KXFAAGROUNDSTOPLIFT-13NOV26?with_nested_markets=true
```

Two pages were retrieved from:

```
https://external-api.kalshi.com/trade-api/v2/series/KXFAAGROUNDSTOPLIFT/events/KXFAAGROUNDSTOPLIFT-13NOV26/candlesticks
```

Both used `period_interval=1` and `end_ts=1794618900`. The first used `start_ts=1794606600`, and its `adjusted_end_ts=1794612840` became the second page’s start. The second reached the requested end. Overlapping candles are deduplicated; contradictory overlaps fail the build. Decimal `close_dollars` values are used directly, never last-trade prices or integer-cent assumptions.

`test/history.test.mjs` checks missing periods, boundary exclusion, pagination, unopened contracts, settlement isolation, and the real archive’s coverage. The settled event’s opening/closing metadata cannot capture any temporary intra-period trading pauses, and candle closes approximate a synchronous order-book snapshot.

## Math and scope

Contracts are cumulative `P(T < deadline)` conditions, not mutually exclusive buckets. The model uses YES bid/ask midpoints and fits a nondecreasing CDF with inverse-squared spread weights (2 percentage-point floor). Deadline parsing is deliberately scoped to this November 2026 EST event; it does not use mutable early-close timestamps. Missing, crossed, inactive, and expired quotes, and spreads of 98 percentage points or wider, are excluded.

The curve is anchored at 0% at retrieval time, conditional on no qualifying announcement yet. Quantiles use linear interpolation. The central 50/80/90% intervals use the 25–75/10–90/5–95 percentiles. If the upper percentile is outside the observed contracts, it remains open-ended. Bid/ask bands are quote-sensitivity measures, not statistical confidence intervals. The mean integrates the survival curve and adds tail probability times a user-selected average additional wait beyond the last cutoff. A settled YES switches to the window between the latest preceding NO and earliest YES, without inventing an exact announcement time.

The event resolves on the FAA's official nationwide lifting announcement, not a future plan, a regional exception, or a particular flight's departure.

## References

- https://docs.kalshi.com/getting_started/quick_start_market_data
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/project-configuration/vercel-json
