const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { readAccounts } = require('../src/dataStore');

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
