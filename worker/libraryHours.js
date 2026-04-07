// ES module port of src/libraryHours.js
// Keep in sync with src/libraryHours.js

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

const CLOSURE_DATES_2026 = new Set([
  '2026-01-01', '2026-01-02',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21',
  '2026-02-27', '2026-02-28',
  '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-31', '2026-06-01',
  '2026-10-04', '2026-10-05',
  '2026-10-09', '2026-10-10',
]);

function getTaipeiDateStr(date) {
  const d = date || new Date();
  const taipei = new Date(d.getTime() + 8 * 3600000);
  return taipei.toISOString().slice(0, 10);
}

function parseTaipei(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  const taipei = new Date(d.getTime() + 8 * 3600000);
  return {
    year: taipei.getUTCFullYear(),
    month: taipei.getUTCMonth(),
    date: taipei.getUTCDate(),
    day: taipei.getUTCDay(),
  };
}

function shiftDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  d.setTime(d.getTime() + n * 86400000);
  const taipei = new Date(d.getTime() + 8 * 3600000);
  return taipei.toISOString().slice(0, 10);
}

function isFirstThursday(dateStr) {
  const { date, day } = parseTaipei(dateStr);
  return day === 4 && date <= 7;
}

export function isClosed(dateStr) {
  if (CLOSURE_DATES_2026.has(dateStr)) return true;
  if (isFirstThursday(dateStr)) return true;
  return false;
}

export function getClosureReason(dateStr) {
  if (CLOSURE_DATES_2026.has(dateStr)) return '國定假日';
  if (isFirstThursday(dateStr)) return '清館日';
  return null;
}

export function getLastOpenDay(deadlineDateStr) {
  let ds = deadlineDateStr;
  for (let i = 0; i < 14; i++) {
    if (!isClosed(ds)) return ds;
    ds = shiftDays(ds, -1);
  }
  return deadlineDateStr;
}

function formatDateWithDay(dateStr) {
  const { month, date, day } = parseTaipei(dateStr);
  return `${month + 1}/${date}（${DAY_NAMES[day]}）`;
}

export function buildClosureCalendar() {
  const today = getTaipeiDateStr();
  let msg = '🏢 開館資訊（未來 7 天）\n───────\n\n';

  let ds = today;
  for (let i = 0; i < 7; i++) {
    const label = formatDateWithDay(ds);
    const reason = getClosureReason(ds);

    if (reason) {
      msg += `${label} ❌ 休館（${reason}）\n`;
    } else {
      msg += `${label} ✅ 開館\n`;
    }
    ds = shiftDays(ds, 1);
  }

  return msg.trim();
}

export function getTodayStatusLine() {
  const today = getTaipeiDateStr();
  const label = formatDateWithDay(today);
  const reason = getClosureReason(today);

  if (reason) {
    return `🏢 今天 ${label}：❌ 休館（${reason}）`;
  }
  return `🏢 今天 ${label}：正常開館`;
}
