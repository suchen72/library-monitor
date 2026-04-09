const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeHistoryDiff, annotateFirstSeen } = require('../src/dataStore');

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function makeAccount(id, overrides = {}) {
  return {
    id,
    label: id,
    status: 'ok',
    borrowed: [],
    reservations: [],
    ...overrides,
  };
}

function makeBook(title, extras = {}) {
  return {
    title,
    dueDate: '2026-05-01',
    renewalCount: 0,
    canRenew: true,
    reservationCount: 0,
    branch: '總館',
    ...extras,
  };
}

function makeData(accounts) {
  return { lastUpdated: new Date().toISOString(), accounts };
}

// --- computeHistoryDiff ---

describe('computeHistoryDiff', () => {
  it('空舊資料（首次執行）→ 空陣列', () => {
    const oldData = makeData([]);
    const newData = makeData([
      makeAccount('a1', { borrowed: [makeBook('新書 A')] }),
    ]);
    assert.deepEqual(computeHistoryDiff(oldData, newData), []);
  });

  it('書本仍存在（續借，dueDate 改變）→ 空陣列', () => {
    const oldData = makeData([
      makeAccount('a1', {
        borrowed: [makeBook('書 X', { dueDate: '2026-04-01', firstSeen: '2026-03-01' })],
      }),
    ]);
    const newData = makeData([
      makeAccount('a1', {
        borrowed: [makeBook('書 X', { dueDate: '2026-05-01', firstSeen: '2026-03-01', renewalCount: 1 })],
      }),
    ]);
    assert.deepEqual(computeHistoryDiff(oldData, newData), []);
  });

  it('書本從全部帳號 borrowed 消失 → 產生一筆 entry，欄位正確', () => {
    const oldData = makeData([
      makeAccount('a1', {
        borrowed: [makeBook('歸還的書', {
          firstSeen: '2026-03-15',
          renewalCount: 2,
          branch: '西中',
        })],
      }),
    ]);
    const newData = makeData([
      makeAccount('a1', { borrowed: [] }),
    ]);
    const entries = computeHistoryDiff(oldData, newData);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, '歸還的書');
    assert.equal(entries[0].firstSeen, '2026-03-15');
    assert.equal(entries[0].renewalCount, 2);
    assert.equal(entries[0].branch, '西中');
    assert.equal(entries[0].returnedDate, todayLocalISO());
  });

  it('帳號混用：書從 a1 移到 a2 → 不產生歸還 entry', () => {
    const oldData = makeData([
      makeAccount('a1', {
        borrowed: [makeBook('移動的書', { firstSeen: '2026-03-01' })],
      }),
      makeAccount('a2', { borrowed: [] }),
    ]);
    const newData = makeData([
      makeAccount('a1', { borrowed: [] }),
      makeAccount('a2', {
        borrowed: [makeBook('移動的書', { firstSeen: '2026-03-01' })],
      }),
    ]);
    assert.deepEqual(computeHistoryDiff(oldData, newData), []);
  });

  it('一次歸還多本 → 產生對應多筆 entries', () => {
    const oldData = makeData([
      makeAccount('a1', {
        borrowed: [
          makeBook('書 1', { firstSeen: '2026-02-01' }),
          makeBook('書 2', { firstSeen: '2026-02-10' }),
          makeBook('書 3', { firstSeen: '2026-03-01' }),
        ],
      }),
    ]);
    const newData = makeData([
      makeAccount('a1', { borrowed: [makeBook('書 3', { firstSeen: '2026-03-01' })] }),
    ]);
    const entries = computeHistoryDiff(oldData, newData);
    assert.equal(entries.length, 2);
    const titles = entries.map(e => e.title).sort();
    assert.deepEqual(titles, ['書 1', '書 2']);
  });

  it('帳號 status error：scraper 會保留舊 borrowed 到新 results → 不誤判', () => {
    // 模擬 scraper.js:57-65 的錯誤處理：失敗帳號沿用舊 borrowed
    const preserved = makeBook('保留的書', { firstSeen: '2026-03-01' });
    const oldData = makeData([
      makeAccount('a1', { borrowed: [preserved] }),
    ]);
    const newData = makeData([
      makeAccount('a1', {
        status: 'error',
        error: '登入失敗',
        borrowed: [preserved], // scraper 會把舊資料塞回來
      }),
    ]);
    assert.deepEqual(computeHistoryDiff(oldData, newData), []);
  });

  it('firstSeen 缺失仍產生 entry（firstSeen 為 null）', () => {
    const oldData = makeData([
      makeAccount('a1', {
        borrowed: [makeBook('老書', {}) /* 無 firstSeen */],
      }),
    ]);
    const newData = makeData([makeAccount('a1', { borrowed: [] })]);
    const entries = computeHistoryDiff(oldData, newData);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].firstSeen, null);
  });
});

// --- annotateFirstSeen ---

describe('annotateFirstSeen', () => {
  it('新書（舊資料全域都沒有）→ firstSeen = 今天', () => {
    const oldData = makeData([]);
    const newData = makeData([
      makeAccount('a1', { borrowed: [makeBook('新書')] }),
    ]);
    annotateFirstSeen(oldData, newData);
    assert.equal(newData.accounts[0].borrowed[0].firstSeen, todayLocalISO());
  });

  it('已存在於同帳號且有 firstSeen → 沿用', () => {
    const oldData = makeData([
      makeAccount('a1', {
        borrowed: [makeBook('書', { firstSeen: '2026-01-15' })],
      }),
    ]);
    const newData = makeData([
      makeAccount('a1', { borrowed: [makeBook('書')] }),
    ]);
    annotateFirstSeen(oldData, newData);
    assert.equal(newData.accounts[0].borrowed[0].firstSeen, '2026-01-15');
  });

  it('已存在但無 firstSeen（升級情境）→ 設為今天', () => {
    const oldData = makeData([
      makeAccount('a1', { borrowed: [makeBook('老書')] }),
    ]);
    const newData = makeData([
      makeAccount('a1', { borrowed: [makeBook('老書')] }),
    ]);
    annotateFirstSeen(oldData, newData);
    assert.equal(newData.accounts[0].borrowed[0].firstSeen, todayLocalISO());
  });

  it('全域查找：舊資料在 a1，新資料在 a2 → 沿用舊 firstSeen', () => {
    const oldData = makeData([
      makeAccount('a1', {
        borrowed: [makeBook('跨帳號的書', { firstSeen: '2026-02-20' })],
      }),
      makeAccount('a2', { borrowed: [] }),
    ]);
    const newData = makeData([
      makeAccount('a1', { borrowed: [] }),
      makeAccount('a2', { borrowed: [makeBook('跨帳號的書')] }),
    ]);
    annotateFirstSeen(oldData, newData);
    assert.equal(newData.accounts[1].borrowed[0].firstSeen, '2026-02-20');
  });

  it('多本書混合：新舊各自正確標記', () => {
    const oldData = makeData([
      makeAccount('a1', {
        borrowed: [
          makeBook('舊書 A', { firstSeen: '2026-01-01' }),
          makeBook('舊書 B', { firstSeen: '2026-02-01' }),
        ],
      }),
    ]);
    const newData = makeData([
      makeAccount('a1', {
        borrowed: [
          makeBook('舊書 A'),
          makeBook('新書 C'),
        ],
      }),
    ]);
    annotateFirstSeen(oldData, newData);
    const books = newData.accounts[0].borrowed;
    const a = books.find(b => b.title === '舊書 A');
    const c = books.find(b => b.title === '新書 C');
    assert.equal(a.firstSeen, '2026-01-01');
    assert.equal(c.firstSeen, todayLocalISO());
  });
});
