// 台北市立圖書館休館日判斷
// 來源：https://tpml.gov.taipei/
// CLOSURE_DATES 需每年底更新

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

// 2026 年臺北市立圖書館休館日
// 來源：北市圖「115年休館日一覽表」
const CLOSURE_DATES_2026 = new Map([
  ['2026-01-01', '開國紀念日'],
  ['2026-02-15', '春節'],
  ['2026-02-16', '春節'],
  ['2026-02-17', '春節'],
  ['2026-02-18', '春節'],
  ['2026-02-19', '春節'],
  ['2026-02-20', '春節'],
  ['2026-02-28', '和平紀念日'],
  ['2026-04-04', '兒童節、清明節'],
  ['2026-04-05', '兒童節、清明節'],
  ['2026-05-01', '勞動節'],
  ['2026-06-19', '端午節'],
  ['2026-09-25', '中秋節'],
  ['2026-09-28', '孔子誕辰紀念日/教師節'],
  ['2026-10-10', '國慶日'],
  ['2026-10-25', '臺灣光復暨金門古寧頭大捷紀念日'],
  ['2026-11-28', '地方公職人員選舉日'],
  ['2026-12-25', '行憲紀念日'],
]);

/**
 * 取得台北日期字串 YYYY-MM-DD
 * 在 UTC 環境（GitHub Actions / Cloudflare Workers）也能正確運作
 */
function getTaipeiDateStr(date) {
  const d = date || new Date();
  const taipei = new Date(d.getTime() + 8 * 3600000);
  return taipei.toISOString().slice(0, 10);
}

/**
 * 解析 YYYY-MM-DD 為台北時間的日期元件
 * 所有日期邏輯都用此函式，避免 local timezone 和 UTC 的混亂
 */
function parseTaipei(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  const taipei = new Date(d.getTime() + 8 * 3600000);
  return {
    year: taipei.getUTCFullYear(),
    month: taipei.getUTCMonth(),  // 0-based
    date: taipei.getUTCDate(),
    day: taipei.getUTCDay(),      // 0=日 1=一 ... 6=六
  };
}

/**
 * 從 YYYY-MM-DD 往前/後推 n 天，回傳新的 YYYY-MM-DD
 */
function shiftDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  d.setTime(d.getTime() + n * 86400000);
  const taipei = new Date(d.getTime() + 8 * 3600000);
  return taipei.toISOString().slice(0, 10);
}

/**
 * 判斷是否為每月第一個週四（清館日）
 */
function isFirstThursday(dateStr) {
  const { date, day } = parseTaipei(dateStr);
  return day === 4 && date <= 7;
}

/**
 * 判斷該日期是否休館
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {boolean}
 */
function isClosed(dateStr) {
  if (CLOSURE_DATES_2026.has(dateStr)) return true;
  if (isFirstThursday(dateStr)) return true;
  return false;
}

/**
 * 取得休館原因
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string|null} 休館原因，null 表示正常開館
 */
function getClosureReason(dateStr) {
  if (CLOSURE_DATES_2026.has(dateStr)) return CLOSURE_DATES_2026.get(dateStr);
  if (isFirstThursday(dateStr)) return '清館日';
  return null;
}

/**
 * 從截止日往回找最後一個開館日
 * 如果截止日本身是開館日，回傳截止日本身
 * @param {string} deadlineDateStr - YYYY-MM-DD
 * @returns {string} YYYY-MM-DD
 */
function getLastOpenDay(deadlineDateStr) {
  // 最多往回找 14 天，避免無限迴圈
  let ds = deadlineDateStr;
  for (let i = 0; i < 14; i++) {
    if (!isClosed(ds)) return ds;
    ds = shiftDays(ds, -1);
  }
  return deadlineDateStr; // fallback
}

/**
 * 格式化日期為 M/D（星期X）
 */
function formatDateWithDay(dateStr) {
  const { month, date, day } = parseTaipei(dateStr);
  return `${month + 1}/${date}（${DAY_NAMES[day]}）`;
}

/**
 * 產生今天起 7 天的休館日曆
 * @returns {string} 格式化的訊息
 */
function buildClosureCalendar() {
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

/**
 * 取得今日開館狀態的一行摘要
 * @returns {string} 例如 "🏢 今天（4/5 六）：正常開館"
 */
function getTodayStatusLine() {
  const today = getTaipeiDateStr();
  const label = formatDateWithDay(today);
  const reason = getClosureReason(today);

  if (reason) {
    return `🏢 今天 ${label}：❌ 休館（${reason}）`;
  }
  return `🏢 今天 ${label}：正常開館`;
}

module.exports = {
  isClosed,
  getClosureReason,
  getLastOpenDay,
  getTaipeiDateStr,
  buildClosureCalendar,
  getTodayStatusLine,
  formatDateWithDay,
};
