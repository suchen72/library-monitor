require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'library-data.json');
const FAVORITES_PATH = path.join(ROOT, 'data', 'favorites.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'history.json');
const WISHLIST_PATH = path.join(ROOT, 'data', 'wishlist.json');
const SESSIONS_DIR = path.join(ROOT, 'sessions');

function readAccounts() {
  const accounts = [];
  for (let i = 1; ; i++) {
    const card = process.env[`ACCOUNT${i}_CARD`];
    if (!card) break;
    accounts.push({
      id: `account${i}`,
      label: process.env[`ACCOUNT${i}_LABEL`] || `帳號${i}`,
      cardNumber: card,
      password: process.env[`ACCOUNT${i}_PASSWORD`] || '',
    });
  }
  if (accounts.length === 0) {
    throw new Error('找不到帳號設定，請在 .env 中設定 ACCOUNT1_CARD / ACCOUNT1_PASSWORD 等環境變數（參考 .env.example）');
  }
  return accounts;
}

function readData() {
  if (!fs.existsSync(DATA_PATH)) {
    return { lastUpdated: null, accounts: [] };
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function writeData(data) {
  const tmp = DATA_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_PATH);
}

function getSessionPath(accountId) {
  return path.join(SESSIONS_DIR, `account-${accountId}.json`);
}

async function pushToKV(data) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !namespaceId || !apiToken) {
    console.log('[KV] Skipping push: missing CF credentials');
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
    console.log('[KV] Data pushed to Cloudflare KV');
  } else {
    const body = await res.text();
    console.error(`[KV] Push failed (${res.status}): ${body}`);
  }
}

async function readFromKV() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !namespaceId || !apiToken) {
    return null;
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/library-data`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiToken}` },
  });

  if (res.ok) {
    return await res.json();
  }
  return null;
}

// --- Favorites ---

function readFavorites() {
  if (!fs.existsSync(FAVORITES_PATH)) {
    return { tags: ['可可貝貝', '包包', '大人'], favorites: [] };
  }
  const data = JSON.parse(fs.readFileSync(FAVORITES_PATH, 'utf8'));
  if (!data.tags) data.tags = ['可可貝貝', '包包', '大人'];
  return data;
}

function writeFavorites(data) {
  const dir = path.dirname(FAVORITES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = FAVORITES_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, FAVORITES_PATH);
}

async function pushFavoritesToKV(data) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !namespaceId || !apiToken) return;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/favorites`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[KV] Favorites push failed (${res.status}): ${body}`);
  }
}

async function readFavoritesFromKV() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !namespaceId || !apiToken) return null;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/favorites`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiToken}` },
  });

  if (res.ok) return await res.json();
  return null;
}

// --- Reading history ---

function readHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    return { entries: [] };
  }
  const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  if (!Array.isArray(data.entries)) data.entries = [];
  return data;
}

function writeHistory(data) {
  const dir = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = HISTORY_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, HISTORY_PATH);
}

async function pushHistoryToKV(data) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !namespaceId || !apiToken) return;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/history`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[KV] History push failed (${res.status}): ${body}`);
  }
}

async function readHistoryFromKV() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !namespaceId || !apiToken) return null;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/history`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiToken}` },
  });

  if (res.ok) return await res.json();
  return null;
}

// --- Wishlist ---

function readWishlist() {
  if (!fs.existsSync(WISHLIST_PATH)) {
    return { tags: ['可可貝貝', '包包', '大人'], wishlist: [] };
  }
  const data = JSON.parse(fs.readFileSync(WISHLIST_PATH, 'utf8'));
  if (!data.tags) data.tags = ['可可貝貝', '包包', '大人'];
  if (!Array.isArray(data.wishlist)) data.wishlist = [];
  return data;
}

function writeWishlist(data) {
  const dir = path.dirname(WISHLIST_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = WISHLIST_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, WISHLIST_PATH);
}

async function pushWishlistToKV(data) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !namespaceId || !apiToken) return;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/wishlist`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[KV] Wishlist push failed (${res.status}): ${body}`);
  }
}

async function readWishlistFromKV() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !namespaceId || !apiToken) return null;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/wishlist`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiToken}` },
  });

  if (res.ok) return await res.json();
  return null;
}

// --- Pure function: build "owned" title set for wishlist status ---

function buildOwnedTitleSet(libraryData, historyData) {
  const set = new Set();
  for (const a of (libraryData?.accounts || [])) {
    for (const b of (a.borrowed || [])) if (b?.title) set.add(b.title);
    for (const r of (a.reservations || [])) if (r?.title) set.add(r.title);
  }
  for (const e of (historyData?.entries || [])) if (e?.title) set.add(e.title);
  return set;
}

// --- Pure functions for scrape-time diff + firstSeen annotation ---
// 閱讀歷史採全域 title 比對（借書帳號混用，不區分帳號歸屬）。

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 把 data 物件中所有帳號的 borrowed 書本合成一個以 title 為 key 的 map。
// 同名書若在多個帳號同時出現，後見的會覆蓋前者（使用者已接受此限制）。
function buildGlobalBorrowedMap(data) {
  const map = new Map();
  for (const account of (data?.accounts || [])) {
    for (const book of (account.borrowed || [])) {
      if (book?.title) map.set(book.title, book);
    }
  }
  return map;
}

// 把 newData.accounts[*].borrowed[*] 加上 firstSeen 欄位。
// 若舊資料全域存在同 title 且有 firstSeen，沿用；否則設為今天。
// Mutates newData in place.
function annotateFirstSeen(oldData, newData) {
  const oldMap = buildGlobalBorrowedMap(oldData);
  const today = todayLocalISO();
  for (const account of (newData?.accounts || [])) {
    for (const book of (account.borrowed || [])) {
      if (!book?.title) continue;
      const prev = oldMap.get(book.title);
      book.firstSeen = prev?.firstSeen || today;
    }
  }
  return newData;
}

// 比對 old vs new borrowed 書本（全域、以 title 為 key），
// 回傳在舊資料存在但新資料消失的書本 → history entries。
// 失敗帳號在 scraper 層已把舊資料保留進 results，因此其 title 仍會出現在 newMap 中，
// 不會被誤判為歸還，這裡不需要特別處理 status 旗標。
function computeHistoryDiff(oldData, newData) {
  const oldMap = buildGlobalBorrowedMap(oldData);
  const newMap = buildGlobalBorrowedMap(newData);
  const returnedDate = todayLocalISO();
  const entries = [];
  for (const [title, oldBook] of oldMap) {
    if (newMap.has(title)) continue;
    entries.push({
      title,
      firstSeen: oldBook.firstSeen || null,
      returnedDate,
      renewalCount: oldBook.renewalCount ?? 0,
      branch: oldBook.branch || null,
    });
  }
  return entries;
}

module.exports = {
  readAccounts, readData, writeData, getSessionPath, pushToKV, readFromKV,
  readFavorites, writeFavorites, pushFavoritesToKV, readFavoritesFromKV,
  readHistory, writeHistory, pushHistoryToKV, readHistoryFromKV,
  readWishlist, writeWishlist, pushWishlistToKV, readWishlistFromKV,
  buildOwnedTitleSet,
  annotateFirstSeen, computeHistoryDiff,
};
