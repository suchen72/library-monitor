require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'library-data.json');
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

module.exports = { readAccounts, readData, writeData, getSessionPath, pushToKV, readFromKV };
