const express = require('express');
const cron = require('node-cron');
const path = require('path');
const EventEmitter = require('events');
const { scrapeAll } = require('./scraper');
const { readData } = require('./dataStore');
const { notifyDaily } = require('./notifier');

const app = express();
const PORT = process.env.PORT || 3000;
const events = new EventEmitter();
events.setMaxListeners(50);

let isRefreshing = false;

// --- Static files ---
app.use(express.static(path.join(__dirname, '..', 'docs')));

// --- API: Get cached data ---
app.get('/api/data', (req, res) => {
  try {
    const data = readData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: Trigger refresh ---
app.post('/api/refresh', (req, res) => {
  if (isRefreshing) {
    return res.json({ status: 'already-refreshing' });
  }
  res.json({ status: 'started' });
  triggerRefresh();
});

// --- API: SSE stream for refresh progress ---
app.get('/api/refresh-status', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current status immediately
  if (isRefreshing) {
    res.write(`data: ${JSON.stringify({ type: 'refreshing' })}\n\n`);
  }

  const listener = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'complete' || event.type === 'error-fatal') {
      res.end();
    }
  };

  events.on('scrape', listener);
  req.on('close', () => events.off('scrape', listener));
});

// --- Refresh logic ---
async function triggerRefresh() {
  if (isRefreshing) return;
  isRefreshing = true;
  console.log(`[${new Date().toISOString()}] Starting refresh...`);

  try {
    await scrapeAll((event) => {
      console.log('[scrape event]', event);
      events.emit('scrape', event);
    });
    console.log(`[${new Date().toISOString()}] Refresh complete.`);

    // Check for alerts and send email notifications
    const latestData = readData();
    await notifyDaily(latestData);
  } catch (err) {
    console.error('Refresh failed:', err.message);
    events.emit('scrape', { type: 'error-fatal', message: err.message });
  } finally {
    isRefreshing = false;
  }
}

// --- Daily cron: 22:00 every day ---
cron.schedule('0 22 * * *', () => {
  console.log('[cron] Daily refresh triggered');
  triggerRefresh();
});

// --- Start server ---
app.listen(PORT, '127.0.0.1', () => {
  console.log(`圖書館儀表板已啟動: http://localhost:${PORT}`);
  console.log('每天 22:00 自動更新，或點擊儀表板上的「立即更新」手動觸發');
});
