const express = require('express');
const cron = require('node-cron');
const path = require('path');
const EventEmitter = require('events');
const { scrapeAll } = require('./scraper');
const {
  readData, readFromKV, pushToKV,
  readFavorites, writeFavorites, pushFavoritesToKV, readFavoritesFromKV,
  readHistory, readHistoryFromKV, pushHistoryToKV,
  readWishlist, writeWishlist, pushWishlistToKV, readWishlistFromKV,
} = require('./dataStore');
const { notifyDaily } = require('./notifier');
const { renewBook, renewByAccount } = require('./renewer');
const { searchCatalog } = require('./catalogSearch');
const { reserveBook } = require('./reserver');

const app = express();
const PORT = process.env.PORT || 3000;
const events = new EventEmitter();
events.setMaxListeners(50);

let isRefreshing = false;

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'docs')));

// --- API: Get data from KV (single source of truth) ---
app.get('/api/data', async (req, res) => {
  try {
    const data = await readFromKV();
    if (data) {
      res.json(data);
    } else {
      // Fallback to local file if KV unavailable
      res.json(readData());
    }
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

// --- API: Favorites ---
app.get('/api/favorites', async (req, res) => {
  try {
    const data = await readFavoritesFromKV();
    res.json(data || readFavorites());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/favorites', async (req, res) => {
  try {
    const { title, tag } = req.body;
    if (!title || !tag) return res.status(400).json({ error: 'title and tag required' });

    const data = readFavorites();
    const existing = data.favorites.find(f => f.title === title);
    if (existing) {
      if (!existing.tags.includes(tag)) existing.tags.push(tag);
    } else {
      data.favorites.push({ title, tags: [tag], dateAdded: new Date().toISOString() });
    }
    writeFavorites(data);
    await pushFavoritesToKV(data);
    res.json({ status: 'added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: Reading history ---
app.get('/api/history', async (req, res) => {
  try {
    const kvData = await readHistoryFromKV();
    const data = (kvData?.entries?.length > 0) ? kvData : readHistory();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: Wishlist ---
app.get('/api/wishlist', async (req, res) => {
  try {
    const data = await readWishlistFromKV();
    res.json(data || readWishlist());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/catalog-search', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  try {
    const results = await searchCatalog(keyword, 10);
    res.json({ results });
  } catch (err) {
    console.error('[catalog-search] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wishlist', async (req, res) => {
  try {
    const { title, tags, note, bookId, holdings, reservable, waitingCount } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });

    const data = readWishlist();
    const existing = data.wishlist.find(w => w.title === title);
    if (existing) {
      if (Array.isArray(tags)) {
        for (const t of tags) {
          if (t && !existing.tags.includes(t)) existing.tags.push(t);
        }
      }
      if (note !== undefined) existing.note = note;
      if (bookId) existing.bookId = bookId;
      if (holdings !== undefined) existing.holdings = holdings;
      if (reservable !== undefined) existing.reservable = reservable;
      if (waitingCount !== undefined) existing.waitingCount = waitingCount;
    } else {
      data.wishlist.push({
        title,
        tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
        note: note || '',
        dateAdded: new Date().toISOString(),
        ...(bookId && { bookId }),
        ...(holdings !== undefined && { holdings }),
        ...(reservable !== undefined && { reservable }),
        ...(waitingCount !== undefined && { waitingCount }),
      });
    }
    writeWishlist(data);
    await pushWishlistToKV(data);
    res.json({ status: 'added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wishlist', async (req, res) => {
  try {
    const { title, tag } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });

    const data = readWishlist();
    if (tag) {
      const existing = data.wishlist.find(w => w.title === title);
      if (existing) {
        existing.tags = existing.tags.filter(t => t !== tag);
      }
    } else {
      data.wishlist = data.wishlist.filter(w => w.title !== title);
    }
    writeWishlist(data);
    await pushWishlistToKV(data);
    res.json({ status: 'removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: Renew books ---
app.post('/api/renew', async (req, res) => {
  const { title, accountId } = req.body;
  if (!title || !accountId) {
    return res.status(400).json({ error: 'title and accountId required' });
  }
  res.json({ status: 'started' });

  renewBook(accountId, title).then(result => {
    console.log(`[renew] ${result.message}`);
    events.emit('scrape', { type: 'renew-result', ...result, title, accountId });
  }).catch(err => {
    console.error(`[renew] Error:`, err.message);
    events.emit('scrape', { type: 'renew-result', success: false, message: err.message, title, accountId });
  });
});

// Renew renewable books for an account, optionally filtered by due date
app.post('/api/renew-all', async (req, res) => {
  const { accountId, beforeDate } = req.body;
  if (!accountId) {
    return res.status(400).json({ error: 'accountId required' });
  }

  // Filter by due date if provided
  let titles;
  if (beforeDate) {
    const data = readData();
    const account = data.accounts?.find(a => a.id === accountId);
    if (account) {
      titles = (account.borrowed || [])
        .filter(b => b.dueDate && b.dueDate <= beforeDate
          && b.canRenew && (b.renewalCount ?? 0) < 3 && (b.reservationCount ?? 0) === 0)
        .map(b => b.title);
    }
    if (!titles || titles.length === 0) {
      events.emit('scrape', { type: 'renew-all-done', accountId, results: [] });
      return res.json({ status: 'done', message: '沒有符合條件的書' });
    }
  }

  res.json({ status: 'started' });

  renewByAccount(accountId, titles).then(({ results }) => {
    console.log(`[renew-all] ${accountId}: ${results.filter(r => r.success).length} succeeded`);
    for (const r of results) {
      events.emit('scrape', { type: 'renew-result', ...r, accountId });
    }
    events.emit('scrape', { type: 'renew-all-done', accountId, results });
  }).catch(err => {
    console.error(`[renew-all] Error:`, err.message);
    events.emit('scrape', { type: 'renew-all-done', accountId, results: [{ success: false, message: err.message }] });
  });
});

// --- API: Reserve books ---
app.post('/api/reserve', async (req, res) => {
  const { accountId, bookId, title } = req.body;
  if (!accountId || !bookId) {
    return res.status(400).json({ error: 'accountId and bookId required' });
  }
  try {
    console.log(`[reserve] Reserving "${title}" (bookId=${bookId}) for ${accountId}`);
    const result = await reserveBook(accountId, bookId);
    console.log(`[reserve] ${result.message}`);
    res.json(result);
  } catch (err) {
    console.error(`[reserve] Error:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/favorites', async (req, res) => {
  try {
    const { title, tag } = req.body;
    if (!title || !tag) return res.status(400).json({ error: 'title and tag required' });

    const data = readFavorites();
    const existing = data.favorites.find(f => f.title === title);
    if (existing) {
      existing.tags = existing.tags.filter(t => t !== tag);
      if (existing.tags.length === 0) {
        data.favorites = data.favorites.filter(f => f.title !== title);
      }
    }
    writeFavorites(data);
    await pushFavoritesToKV(data);
    res.json({ status: 'removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    await pushToKV(latestData);
    await pushHistoryToKV(readHistory());
    await notifyDaily(latestData);
  } catch (err) {
    console.error('Refresh failed:', err.message);
    events.emit('scrape', { type: 'error-fatal', message: err.message });
  } finally {
    isRefreshing = false;
  }
}

// --- Daily cron: 00:00 every day (Taipei time) ---
cron.schedule('0 0 * * *', () => {
  console.log('[cron] Daily refresh triggered');
  triggerRefresh();
});

// --- Start server ---
app.listen(PORT, '127.0.0.1', () => {
  console.log(`圖書館儀表板已啟動: http://localhost:${PORT}`);
  console.log('每天 00:00 自動更新，或點擊儀表板上的「立即更新」手動觸發');
});
