const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  readAccounts,
  mergeMissingConfiguredAccounts,
} = require('../src/dataStore');

// 儲存原始 ACCOUNT* 環境變數
const originalAccountEnv = {};
for (const key of Object.keys(process.env)) {
  if (key.startsWith('ACCOUNT')) originalAccountEnv[key] = process.env[key];
}

function clearAccountEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ACCOUNT')) delete process.env[key];
  }
}

function restoreAccountEnv() {
  clearAccountEnv();
  for (const [key, val] of Object.entries(originalAccountEnv)) {
    process.env[key] = val;
  }
}

describe('readAccounts', () => {
  beforeEach(() => clearAccountEnv());
  afterEach(() => restoreAccountEnv());

  it('1 個帳號 → 讀出 1 個', () => {
    process.env.ACCOUNT1_CARD = 'FA12345678';
    process.env.ACCOUNT1_PASSWORD = 'pass1';
    process.env.ACCOUNT1_LABEL = '小明';
    const accounts = readAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].cardNumber, 'FA12345678');
    assert.equal(accounts[0].label, '小明');
  });

  it('3 個帳號 → 讀出 3 個', () => {
    for (let i = 1; i <= 3; i++) {
      process.env[`ACCOUNT${i}_CARD`] = `CARD${i}`;
      process.env[`ACCOUNT${i}_PASSWORD`] = `PASS${i}`;
    }
    const accounts = readAccounts();
    assert.equal(accounts.length, 3);
    assert.equal(accounts[2].cardNumber, 'CARD3');
  });

  it('帳號編號有空缺時仍讀出後面的帳號', () => {
    process.env.ACCOUNT1_CARD = 'CARD1';
    process.env.ACCOUNT1_PASSWORD = 'PASS1';
    process.env.ACCOUNT4_CARD = 'CARD4';
    process.env.ACCOUNT4_PASSWORD = 'PASS4';
    process.env.ACCOUNT4_LABEL = 'Daniel';

    const accounts = readAccounts();

    assert.deepEqual(accounts.map(a => a.id), ['account1', 'account4']);
    assert.equal(accounts[1].label, 'Daniel');
  });

  it('忽略空白 CARD 的帳號設定', () => {
    process.env.ACCOUNT1_CARD = 'CARD1';
    process.env.ACCOUNT2_CARD = '';
    process.env.ACCOUNT3_CARD = 'CARD3';

    const accounts = readAccounts();

    assert.deepEqual(accounts.map(a => a.id), ['account1', 'account3']);
  });

  it('無 LABEL → 預設帳號N', () => {
    process.env.ACCOUNT1_CARD = 'CARD1';
    process.env.ACCOUNT1_PASSWORD = 'PASS1';
    const accounts = readAccounts();
    assert.equal(accounts[0].label, '帳號1');
  });

  it('無任何 ACCOUNT → throw error', () => {
    assert.throws(() => readAccounts(), /找不到帳號設定/);
  });
});

describe('mergeMissingConfiguredAccounts', () => {
  it('keeps KV data primary but appends configured accounts found only in local data', () => {
    const kvData = {
      lastUpdated: '2026-05-16T02:17:00.000Z',
      accounts: [
        { id: 'account1', label: 'Apple', borrowed: [{ title: 'A' }] },
        { id: 'account2', label: 'Tomky', borrowed: [{ title: 'B' }] },
        { id: 'account3', label: 'Family', borrowed: [{ title: 'C' }] },
      ],
    };
    const localData = {
      lastUpdated: '2026-05-14T04:09:50.400Z',
      accounts: [
        { id: 'account1', label: 'Old Apple', borrowed: [] },
        { id: 'account4', label: 'Daniel', borrowed: [{ title: 'D' }] },
      ],
    };

    const result = mergeMissingConfiguredAccounts(kvData, localData, [
      'account1',
      'account2',
      'account3',
      'account4',
    ]);

    assert.equal(result.lastUpdated, kvData.lastUpdated);
    assert.deepEqual(result.accounts.map(a => a.id), ['account1', 'account2', 'account3', 'account4']);
    assert.equal(result.accounts[0].label, 'Apple');
    assert.equal(result.accounts[3].label, 'Daniel');
  });

  it('does not append local accounts that are not currently configured', () => {
    const kvData = { accounts: [{ id: 'account1' }] };
    const localData = { accounts: [{ id: 'account4', label: 'Daniel' }] };

    const result = mergeMissingConfiguredAccounts(kvData, localData, ['account1']);

    assert.deepEqual(result.accounts.map(a => a.id), ['account1']);
  });
});
