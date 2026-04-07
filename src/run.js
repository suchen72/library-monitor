#!/usr/bin/env node
// One-shot entry point for GitHub Actions (no Express server, no cron)
// MODE env var controls notification behavior:
//   "daily"   (default) — alert-based notifications, or "no alerts" if nothing
//   "summary" — borrowing & reservation summary
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { scrapeAll } = require('./scraper');
const { readData, pushToKV } = require('./dataStore');
const { notifyDaily, notifySummary, notifyBorrowed, notifyReservations, notifyReturn, notifyClosureStatus } = require('./notifier');
const captchaSolver = require('./captchaSolver');

const mode = process.env.MODE || 'daily';

// Ensure required directories exist
fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

(async () => {
  console.log(`[run] Starting (mode=${mode}) at ${new Date().toISOString()}`);

  try {
    await scrapeAll((event) => {
      console.log('[scrape]', event.type, event.label || '');
    });

    const data = readData();
    await pushToKV(data);

    switch (mode) {
      case 'summary':
        await notifySummary(data);
        break;
      case 'borrowed':
        await notifyBorrowed(data);
        break;
      case 'reservations':
        await notifyReservations(data);
        break;
      case 'return':
        await notifyReturn(data);
        break;
      case 'hours':
        await notifyClosureStatus();
        break;
      case 'daily':
      default:
        await notifyDaily(data);
        break;
    }

    console.log('[run] Done');
  } catch (err) {
    console.error('[run] Fatal error:', err.message);
    process.exitCode = 1;
  } finally {
    await captchaSolver.terminate();
  }
})();
