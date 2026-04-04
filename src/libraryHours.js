// 台北市立圖書館休館日判斷
// 來源：https://tpml.gov.taipei/
// CLOSURE_DATES 需每年底更新

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

// 2026 年國定假日 / 特殊休館日
// 圖書館在國定假日全館休館
const CLOSURE_DATES_2026 = new Set([
  // 元旦
  '2026-01-01', '2026-01-02',
  // 農曆春節（除夕~初五）
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21',
  // 和平紀念日（2/28 六，2/27 五補假）
  '2026-02-27', '2026-02-28',
  // 兒童節+清明節（4/4 六、4/5 日，4/3 五、4/6 一補假）
  '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06',
  // 端午節（5/31 日，6/1 一補假）
  '2026-05-31', '2026-06-01',
  // 中秋節（10/4 日，10/5 一補假）
  '2026-10-04', '2026-10-05',
  // 國慶日（10/10 六，10/9 五補假）
  '2026-10-09', '2026-10-10',
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
 * 判斷是否為每月第一個週四（清館日）
 */
function isFirstThursday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  return d.getDay() === 4 && d.getDate() <= 7;
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
  if (CLOSURE_DATES_2026.has(dateStr)) return '國定假日';
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
  let d = new Date(deadlineDateStr + 'T00:00:00+08:00');
  // 最多往回找 14 天，避免無限迴圈
  for (let i = 0; i < 14; i++) {
    const ds = d.toISOString().slice(0, 10);
    if (!isClosed(ds)) return ds;
    d.setDate(d.getDate() - 1);
  }
  return deadlineDateStr; // fallback
}

/**
 * 格式化日期為 M/D（星期X）
 */
function formatDateWithDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = DAY_NAMES[d.getDay()];
  return `${m}/${day}（${dow}）`;
}

/**
 * 產生今天起 7 天的休館日曆
 * @returns {string} 格式化的訊息
 */
function buildClosureCalendar() {
  const today = getTaipeiDateStr();
  let msg = '🏢 開館資訊（未來 7 天）\n───────\n\n';

  const d = new Date(today + 'T00:00:00+08:00');
  for (let i = 0; i < 7; i++) {
    const ds = d.toISOString().slice(0, 10);
    const label = formatDateWithDay(ds);
    const reason = getClosureReason(ds);

    if (reason) {
      msg += `${label} ❌ 休館（${reason}）\n`;
    } else {
      msg += `${label} ✅ 開館\n`;
    }
    d.setDate(d.getDate() + 1);
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
