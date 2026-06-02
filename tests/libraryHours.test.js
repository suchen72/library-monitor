const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isClosed,
  getClosureReason,
  getLastOpenDay,
  getTaipeiDateStr,
  formatDateWithDay,
  buildClosureCalendar,
  getTodayStatusLine,
} = require('../src/libraryHours');

describe('isClosed', () => {
  it('官方休館日 → true', () => {
    assert.equal(isClosed('2026-01-01'), true);  // 元旦
    assert.equal(isClosed('2026-04-04'), true);  // 兒童節
    assert.equal(isClosed('2026-06-19'), true);  // 端午節
    assert.equal(isClosed('2026-10-10'), true);  // 國慶日
  });

  it('清館日（每月第一個週四）→ true', () => {
    assert.equal(isClosed('2026-04-02'), true);  // 4/2 是第一個週四
    assert.equal(isClosed('2026-07-02'), true);  // 7/2 是第一個週四
  });

  it('一般日 → false', () => {
    assert.equal(isClosed('2026-04-07'), false);
    assert.equal(isClosed('2026-06-01'), false);
    assert.equal(isClosed('2026-06-15'), false);
    assert.equal(isClosed('2026-08-10'), false);
  });

  it('第二個週四不是清館日', () => {
    assert.equal(isClosed('2026-04-09'), false);  // 4/9 是第二個週四
    assert.equal(isClosed('2026-07-09'), false);
  });

  it('國定假日同時是第一個週四 → true', () => {
    // 2026-01-01 是週四且在 CLOSURE_DATES
    assert.equal(isClosed('2026-01-01'), true);
  });
});

describe('getClosureReason', () => {
  it('官方休館日 → 休館原因', () => {
    assert.equal(getClosureReason('2026-04-04'), '兒童節、清明節');
    assert.equal(getClosureReason('2026-02-28'), '和平紀念日');
    assert.equal(getClosureReason('2026-06-19'), '端午節');
  });

  it('清館日 → "清館日"', () => {
    assert.equal(getClosureReason('2026-04-02'), '清館日');
  });

  it('一般日 → null', () => {
    assert.equal(getClosureReason('2026-04-07'), null);
    assert.equal(getClosureReason('2026-06-15'), null);
  });

  it('優先級：官方休館原因 > 清館日', () => {
    // 2026-01-01 同時是官方休館日和第一個週四
    assert.equal(getClosureReason('2026-01-01'), '開國紀念日');
  });
});

describe('getLastOpenDay', () => {
  it('開館日 → 回傳自己', () => {
    assert.equal(getLastOpenDay('2026-04-07'), '2026-04-07');
  });

  it('單日休館 → 前一天', () => {
    // 2026-07-02 是清館日（第一個週四），7/1 是正常日
    assert.equal(getLastOpenDay('2026-07-02'), '2026-07-01');
  });

  it('連續休館 → 跳過整段', () => {
    // 4/4~4/5 是官方休館日，4/3 是開館日
    assert.equal(getLastOpenDay('2026-04-05'), '2026-04-03');
    assert.equal(getLastOpenDay('2026-04-04'), '2026-04-03');
  });

  it('春節長假 → 跳過所有天', () => {
    // 2/15~2/20 春節，2/14 應該是開館日
    const result = getLastOpenDay('2026-02-20');
    assert.equal(isClosed(result), false);
    assert.equal(result, '2026-02-14');
  });
});

describe('getTaipeiDateStr', () => {
  it('UTC 午夜 → 台北已是隔天 08:00', () => {
    const utcMidnight = new Date('2026-04-07T00:00:00Z');
    assert.equal(getTaipeiDateStr(utcMidnight), '2026-04-07');
  });

  it('UTC 15:59 → 台北 23:59，同一天', () => {
    const utc1559 = new Date('2026-04-07T15:59:00Z');
    assert.equal(getTaipeiDateStr(utc1559), '2026-04-07');
  });

  it('UTC 16:00 → 台北隔天 00:00', () => {
    const utc1600 = new Date('2026-04-07T16:00:00Z');
    assert.equal(getTaipeiDateStr(utc1600), '2026-04-08');
  });
});

describe('formatDateWithDay', () => {
  it('正確格式化日期與星期', () => {
    assert.equal(formatDateWithDay('2026-04-07'), '4/7（二）');
    assert.equal(formatDateWithDay('2026-01-01'), '1/1（四）');
    assert.equal(formatDateWithDay('2026-04-05'), '4/5（日）');
  });
});

describe('buildClosureCalendar', () => {
  it('輸出包含 7 行日期', () => {
    const result = buildClosureCalendar();
    const lines = result.split('\n').filter(l => l.match(/^[\d]+\//));
    assert.equal(lines.length, 7);
  });

  it('包含標題', () => {
    const result = buildClosureCalendar();
    assert.ok(result.includes('開館資訊'));
  });

  it('休館日包含 ❌', () => {
    const result = buildClosureCalendar();
    // 結果取決於「今天」，只驗證格式
    assert.ok(result.includes('✅') || result.includes('❌'));
  });
});

describe('getTodayStatusLine', () => {
  it('包含「今天」字樣', () => {
    const result = getTodayStatusLine();
    assert.ok(result.includes('🏢 今天'));
  });

  it('包含開館或休館狀態', () => {
    const result = getTodayStatusLine();
    assert.ok(result.includes('正常開館') || result.includes('休館'));
  });
});
