#!/usr/bin/env node
// One-shot entry point for GitHub Actions (no Express server, no cron)
// MODE env var controls notification behavior:
//   "daily"   (default) — alert-based notifications, or "no alerts" if nothing
//   "summary" — borrowing & reservation summary
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { scrapeAll } = require('./scraper');
const { readData, pushToKV, readHistory, pushHistoryToKV } = require('./dataStore');
const { notifyDaily, notifySummary, notifyBorrowed, notifyReservations, notifyReturn, notifyClosureStatus, notifyRenew, notifyAutoRenew } = require('./notifier');
const { renewAll, autoRenew } = require('./renewer');
const captchaSolver = require('./captchaSolver');

const mode = process.env.MODE || 'daily';
const source = process.env.SOURCE || 'manual';
const notificationChannels = source === 'schedule'
  ? { line: true, email: true }
  : { line: true, email: false };
const lineOnlyChannels = { line: true, email: false };

// Ensure required directories exist
fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

async function scrapeAndSync() {
  await scrapeAll((event) => {
    console.log('[scrape]', event.type, event.label || '');
  });

  const data = readData();
  await pushToKV(data);
  await pushHistoryToKV(readHistory());
  return data;
}

(async () => {
  console.log(`[run] Starting (mode=${mode}, source=${source}) at ${new Date().toISOString()}`);

  try {
    // Renew mode: skip scrape, just renew all and notify
    if (mode === 'renew') {
      const { results } = await renewAll();
      if (results.some(r => r.success)) {
        await scrapeAndSync();
      }
      await notifyRenew(results, notificationChannels);
      console.log('[run] Done (renew)');
      return;
    }

    let data = await scrapeAndSync();

    // Auto-renew books due today (daily mode only)
    if (mode === 'daily') {
      const { results } = await autoRenew(data);
      if (results.length > 0) {
        await notifyAutoRenew(results, lineOnlyChannels);
      }
      if (results.some(r => r.success)) {
        data = await scrapeAndSync();
      }
    }

    switch (mode) {
      case 'summary':
        await notifySummary(data, notificationChannels);
        break;
      case 'borrowed':
        await notifyBorrowed(data, notificationChannels);
        break;
      case 'reservations':
        await notifyReservations(data, notificationChannels);
        break;
      case 'return':
        await notifyReturn(data, notificationChannels);
        break;
      case 'hours':
        await notifyClosureStatus(notificationChannels);
        break;
      case 'daily':
      default:
        await notifyDaily(data, notificationChannels);
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
