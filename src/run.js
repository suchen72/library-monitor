#!/usr/bin/env node
// One-shot entry point for GitHub Actions (no Express server, no cron)
// MODE env var controls notification behavior:
//   "daily"   (default) — alert-based notifications, or "no alerts" if nothing
//   "summary" — borrowing & reservation summary
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { scrapeAll } = require('./scraper');
const { readData } = require('./dataStore');
const { notifyDaily, notifySummary, notifyBorrowed, notifyReservations, notifyReturn, notifyClosureStatus } = require('./notifier');
const captchaSolver = require('./captchaSolver');

const mode = process.env.MODE || 'daily';

// --- Push scraped data to Cloudflare KV ---
async function pushToKV(data) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !namespaceId || !apiToken) {
    console.log('[run] Skipping KV push: missing CF credentials');
    return;
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/library-data`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (res.ok) {
    console.log('[run] Data pushed to Cloudflare KV');
  } else {
    const body = await res.text();
    console.error(`[run] KV push failed (${res.status}): ${body}`);
  }
}

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
