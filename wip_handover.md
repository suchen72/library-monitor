# Closeout: Auto-Renew Day-Before Fix

## Status

This work is complete and ready to deploy.

Completed areas:

- Auto-renew now targets books due today or tomorrow.
- GitHub Actions logs now include one line per auto-renew result, including
  account label, title, success/failure, and message.
- Tests cover the auto-renew target selection rules.

## Problem

- The expected behavior was to auto-renew books the day before they expire.
- The existing implementation only selected books due today:
  `daysUntil(b.dueDate) === 0`.
- When a scheduled GitHub Actions run started late, books could already be
  expired or no longer renewable by the time the workflow attempted renewal.
- The Actions log only showed account-level attempts, so failed/skipped titles
  could not be diagnosed from GitHub logs alone.

## Changes

### `src/notifier.js`

- Updated `getAutoRenewTargets()` to include books with `daysUntil` from 0 to 1.
- Kept existing safety filters:
  - `canRenew === true`
  - `renewalCount < 3`
  - `reservationCount === 0`
  - account `status === "ok"`

### `src/renewer.js`

- Updated auto-renew comments and no-target log text to say "today or tomorrow".
- Added per-title result logging:
  - success/failure
  - account label
  - title
  - renewer message

### `src/run.js`

- Updated the daily mode comment to match the new today-or-tomorrow behavior.

### `tests/notifier.test.js`

- Added coverage for `getAutoRenewTargets()`:
  - includes books due today
  - includes books due tomorrow
  - excludes books due after tomorrow
  - excludes overdue books
  - excludes non-renewable, renewal-count-maxed, reserved, and error-account
    books

## Validation

- `node --check src/notifier.js` passed.
- `node --check src/renewer.js` passed.
- `node --check src/run.js` passed.
- `npm test` passed: 78 tests.

## Deploy Note

- Push to `origin/main` is enough for the next GitHub Actions daily schedule to
  use the new auto-renew target logic.
- Restart any long-running local `npm start` / launchd server process after
  pulling if local daily cron behavior should use this change.
