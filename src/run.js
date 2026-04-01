#!/usr/bin/env node
// One-shot entry point for GitHub Actions (no Express server, no cron)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { scrapeAll } = require('./scraper');
const { readData } = require('./dataStore');
const { checkAndNotify } = require('./notifier');
const captchaSolver = require('./captchaSolver');

// Ensure required directories exist
fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

(async () => {
  console.log(`[run] Starting at ${new Date().toISOString()}`);

  try {
    await scrapeAll((event) => {
      console.log('[scrape]', event.type, event.label || '');
    });

    const data = readData();
    await checkAndNotify(data);

    console.log('[run] Done');
  } catch (err) {
    console.error('[run] Fatal error:', err.message);
    process.exitCode = 1;
  } finally {
    await captchaSolver.terminate();
  }
})();
