# Closeout: Reservation Sync Fix

## Status

This work is closed out and pushed to `main`.

Completed areas:

- The dashboard reservation quota no longer gets stuck below the real value.
- Refreshes requested while another refresh is running are queued, not dropped.
- The browser reloads data only after Cloudflare KV has been updated.

## Problem

- The `剩 X 本可預約` badge is derived from an in-memory `reserveCount` that
  only refreshes when `loadData()` runs.
- A refresh triggered after a reservation (`refreshAfterMutation`) was silently
  dropped when another refresh was already running (`isRefreshing` guard).
- The SSE `complete` event fired after scraping but before the KV push, so a
  client reloading on `complete` could read stale KV and overwrite the
  optimistic count back down.
- Net effect: a reservation made on the dashboard could leave the quota stuck
  showing free slots that no longer existed.

## Changes

### `src/server.js`

- `triggerRefresh` queues a follow-up in `pendingRefresh` instead of dropping
  the request when `isRefreshing` is true; a loop runs the queued refresh after
  the current one finishes, so a mutation always gets a covering re-scrape.
- Scrape body extracted into `runRefresh`, which emits a new `synced` event
  after `pushToKV` / `pushHistoryToKV` succeed.
- `/api/refresh-status` ends the SSE stream on `synced` instead of `complete`.
- A notification failure no longer surfaces as a refresh failure.
- `mergeRefreshOptions` keeps a notifying (daily) refresh ahead of silent
  mutation refreshes when both are queued.

### `docs/app.js`

- Added `connectRefreshStream()` — one persistent EventSource opened on load.
  The browser auto-reconnects after the server ends the stream, so every
  refresh (manual, post-reserve, post-renew, daily cron) reconciles the
  dashboard once its data is synced.
- `loadData()` is called on `synced` only — never on `complete`.
- Rewrote the `triggerRefresh` button handler; removed `listenRefreshStatus()`.
- `setRefreshingUI` drives button state and has a safety timeout.
- `reserveBook` keeps its optimistic `reserveCount++` for instant feedback;
  the persistent stream corrects it once the background refresh syncs.

## Event Model

- `started` / `logging-in` / `done` — per-account scrape progress.
- `complete` — scraping finished; KV not yet updated.
- `synced` — scrape finished AND data pushed to KV; clients may reload.
- `error-fatal` — scrape or KV push failed.

## Validation

- `node --check` on `src/server.js` and `docs/app.js` passed.
- `npm test` — 76 tests passed.
- New server booted on a test port; startup clean and SSE endpoint reachable.

## Deploy Note

- The long-running server (launchd / `npm start`) must be restarted to pick up
  these changes.

## Future Work

- Give a still-pending reservation its own optimistic state so a mid-chain
  refresh cannot briefly hide it before the follow-up refresh confirms it.
- Make `RESERVE_LIMIT` (hardcoded `7` in `docs/app.js`) configurable per card.
