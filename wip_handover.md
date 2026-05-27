# Closeout: Refresh Status SSE Crash Fix

## Status

This work is complete and ready to deploy.

Completed areas:

- The server no longer crashes with `ERR_STREAM_WRITE_AFTER_END` when refreshes
  happen back-to-back.
- SSE listeners for `/api/refresh-status` are cleaned up when the stream ends,
  the client disconnects, or the response errors.
- Reservation-triggered refresh behavior is unchanged: successful reservations
  still request a background all-account refresh, and queued refresh requests
  are still coalesced while one is already running.

## Problem

- `/api/refresh-status` registered a `scrape` listener for each SSE response.
- When a refresh emitted `synced` or `error-fatal`, the server called
  `res.end()`, but the listener was only removed on `req.close`.
- In a fast follow-up refresh, the stale listener could receive the next
  `started` event and call `res.write()` on an already-ended response.
- On Node 25 this surfaced as an unhandled `ServerResponse` error:
  `ERR_STREAM_WRITE_AFTER_END`, which terminated the server process.

## Changes

### `src/server.js`

- Added an idempotent `cleanup()` helper inside `/api/refresh-status`.
- Removed the SSE listener before ending the response on `synced` or
  `error-fatal`.
- Added guards for `res.writableEnded` and `res.destroyed` before writing.
- Added cleanup hooks for `req.close`, `res.close`, `res.finish`, and
  `res.error`.
- Logged SSE response errors after cleanup so they no longer become unhandled
  process crashes.

## Refresh Behavior Notes

- Manual refresh, daily cron, successful reservation, successful single renew,
  and successful batch renew all still use the same refresh pipeline.
- Refreshes are all-account refreshes because `runRefresh()` calls
  `scrapeAll()`.
- If multiple reservation or renew actions request refresh while one is already
  running, they are merged into one follow-up refresh through `pendingRefresh`.

## Validation

- `node --check src/server.js` passed.
- `node --check docs/app.js` passed.
- `npm test` passed: 76 tests.

## Deploy Note

- Restart the long-running server process (`launchd` / `npm start`) after this
  change is pulled, otherwise the running Node process will still have the old
  SSE listener behavior.
