const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAlerts,
  buildReservations,
  buildReturnAdvice,
  buildSummary,
} = require('../src/notifier');

// 產生相對於今天的日期字串（使用 local time 格式，與 notifier 的 getToday() 一致）
function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function makeData(accounts) {
  return { lastUpdated: new Date().toISOString(), accounts };
}

function makeAccount(overrides = {}) {
  return {
    label: '測試帳號',
    status: 'ok',
    borrowed: [],
    reservations: [],
    borrowLimit: 25,
    ...overrides,
  };
}

// --- buildAlerts ---

describe('buildAlerts', () => {
  it('空資料 → 空陣列', () => {
    const alerts = buildAlerts(makeData([]));
    assert.deepEqual(alerts, []);
  });

  it('帳號 status !== ok → 跳過', () => {
    const alerts = buildAlerts(makeData([
      makeAccount({
        status: 'error',
        borrowed: [{ title: 'Book', dueDate: daysFromNow(-1) }],
      }),
    ]));
    assert.deepEqual(alerts, []);
  });

  it('逾期書 → overdue alert', () => {
    const alerts = buildAlerts(makeData([
      makeAccount({
        borrowed: [{ title: '逾期書', dueDate: daysFromNow(-3) }],
      }),
    ]));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'overdue');
    assert.ok(alerts[0].detail.includes('3'));
  });

  it('今天到期 → due-soon alert', () => {
    const alerts = buildAlerts(makeData([
      makeAccount({
        borrowed: [{ title: '今天到期', dueDate: daysFromNow(0) }],
      }),
    ]));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'due-soon');
    assert.equal(alerts[0].detail, '今天到期');
  });

  it('2天內到期 → due-soon', () => {
    const alerts = buildAlerts(makeData([
      makeAccount({
        borrowed: [{ title: 'Book', dueDate: daysFromNow(2) }],
      }),
    ]));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'due-soon');
  });

  it('3天後到期 → 不產生 alert', () => {
    const alerts = buildAlerts(makeData([
      makeAccount({
        borrowed: [{ title: 'Book', dueDate: daysFromNow(3) }],
      }),
    ]));
    assert.equal(alerts.length, 0);
  });

  it('預約書到館 daysLeft >= 4 → pickup-ready', () => {
    const alerts = buildAlerts(makeData([
      makeAccount({
        reservations: [{
          title: '預約書', isReady: true,
          pickupDeadline: daysFromNow(5), pickupBranch: '舊莊分館',
        }],
      }),
    ]));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'pickup-ready');
  });

  it('預約書到館 daysLeft <= 2 → pickup-expiring', () => {
    const alerts = buildAlerts(makeData([
      makeAccount({
        reservations: [{
          title: '快截止', isReady: true,
          pickupDeadline: daysFromNow(1), pickupBranch: '舊莊分館',
        }],
      }),
    ]));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'pickup-expiring');
  });

  it('預約書到館 daysLeft = 3 → 不產生 alert', () => {
    // daysFromNow(2) 經 Math.ceil + UTC/local 時差後，daysLeft = 3
    const alerts = buildAlerts(makeData([
      makeAccount({
        reservations: [{
          title: 'Book', isReady: true,
          pickupDeadline: daysFromNow(2), pickupBranch: '舊莊分館',
        }],
      }),
    ]));
    assert.equal(alerts.length, 0);
  });

  it('isReady = false → 不產生 alert', () => {
    const alerts = buildAlerts(makeData([
      makeAccount({
        reservations: [{
          title: 'Book', isReady: false,
          pickupDeadline: daysFromNow(1), pickupBranch: '舊莊分館',
        }],
      }),
    ]));
    assert.equal(alerts.length, 0);
  });
});

// --- buildReservations ---

describe('buildReservations', () => {
  it('無預約 → 顯示「沒有可領取或調閱中的書」', () => {
    const msg = buildReservations(makeData([makeAccount()]));
    assert.ok(msg.includes('沒有可領取或調閱中的書'));
  });

  it('截止日正常 → 不顯示「最後取書」', () => {
    // 用一個確定不是休館日的日期
    const msg = buildReservations(makeData([
      makeAccount({
        reservations: [{
          title: 'BookA', isReady: true,
          pickupDeadline: '2026-04-07', pickupBranch: '舊莊分館',
        }],
      }),
    ]));
    assert.ok(!msg.includes('最後取書'));
  });

  it('截止日遇休館 → 顯示「最後取書」', () => {
    // 2026-04-04 是國定假日
    const msg = buildReservations(makeData([
      makeAccount({
        reservations: [{
          title: 'BookB', isReady: true,
          pickupDeadline: '2026-04-04', pickupBranch: '親子美育數位館',
        }],
      }),
    ]));
    assert.ok(msg.includes('最後取書'));
    assert.ok(msg.includes('休館'));
  });

  it('調閱中的書也顯示', () => {
    const msg = buildReservations(makeData([
      makeAccount({
        reservations: [{
          title: '調閱書', isReady: false, isInTransit: true,
          pickupBranch: '舊莊分館',
        }],
      }),
    ]));
    assert.ok(msg.includes('調閱中'));
    assert.ok(msg.includes('調閱書'));
  });
});

// --- buildReturnAdvice ---

describe('buildReturnAdvice', () => {
  it('未超限 → 顯示 ✅', () => {
    const msg = buildReturnAdvice(makeData([
      makeAccount({
        borrowed: [
          { title: 'Book1', dueDate: daysFromNow(10) },
          { title: 'Book2', dueDate: daysFromNow(15) },
        ],
        borrowLimit: 25,
      }),
    ]));
    assert.ok(msg.includes('✅'));
    assert.ok(msg.includes('不需額外還書'));
  });

  it('超出上限 → 顯示 ⚠️', () => {
    // 借了 3 本，上限 2，有 1 本待取 → projected = 3 - 0 + 1 = 4 > 2
    const msg = buildReturnAdvice(makeData([
      makeAccount({
        borrowed: [
          { title: 'B1', dueDate: daysFromNow(10) },
          { title: 'B2', dueDate: daysFromNow(10) },
          { title: 'B3', dueDate: daysFromNow(10) },
        ],
        reservations: [{ title: 'R1', isReady: true }],
        borrowLimit: 2,
      }),
    ]));
    assert.ok(msg.includes('⚠️'));
  });

  it('使用 account.borrowLimit', () => {
    // 借 30 本，上限 30 → 剛好不超
    const borrowed = Array.from({ length: 30 }, (_, i) => ({
      title: `Book${i}`, dueDate: daysFromNow(10),
    }));
    const msg = buildReturnAdvice(makeData([
      makeAccount({ borrowed, borrowLimit: 30 }),
    ]));
    assert.ok(msg.includes('30/30'));
    assert.ok(msg.includes('✅'));
  });
});

// --- buildSummary ---

describe('buildSummary', () => {
  it('包含今日開館狀態', () => {
    const msg = buildSummary(makeData([makeAccount()]));
    assert.ok(msg.includes('🏢 今天'));
  });

  it('帳號失敗 → 顯示 ❌', () => {
    const msg = buildSummary(makeData([
      makeAccount({ status: 'error', label: '失敗帳號' }),
    ]));
    assert.ok(msg.includes('❌'));
    assert.ok(msg.includes('失敗帳號'));
  });

  it('顯示借閱數量', () => {
    const msg = buildSummary(makeData([
      makeAccount({
        borrowed: [
          { title: 'B1', dueDate: daysFromNow(5) },
          { title: 'B2', dueDate: daysFromNow(10) },
        ],
      }),
    ]));
    assert.ok(msg.includes('借閱 2 本'));
  });

  it('有可取預約 → 顯示可取數量', () => {
    const msg = buildSummary(makeData([
      makeAccount({
        reservations: [
          { title: 'R1', isReady: true },
          { title: 'R2', isReady: false },
        ],
      }),
    ]));
    assert.ok(msg.includes('1 本可取'));
  });
});
