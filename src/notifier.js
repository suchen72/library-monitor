require('dotenv').config();
const nodemailer = require('nodemailer');
const { readLineConfig, sendLineMessage } = require('./lineNotifier');
const { isClosed, getLastOpenDay, getTodayStatusLine, buildClosureCalendar } = require('./libraryHours');

// --- Account borrow limits ---
const DEFAULT_BORROW_LIMIT = 25;

// --- Email config ---

function readEmailConfig() {
  if (process.env.EMAIL_ENABLED !== 'true') return null;
  const sender = process.env.EMAIL_SENDER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  const recipient = process.env.EMAIL_RECIPIENT;
  if (!sender || !pass || !recipient) return null;
  return { enabled: true, senderEmail: sender, senderAppPassword: pass, recipientEmail: recipient };
}

// --- Helpers ---
// Keep in sync with worker/formatters.js

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr) - getToday()) / 86400000);
}

function shortDate(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function shortTime(iso) {
  if (!iso) return '未知';
  const d = new Date(iso);
  const tw = new Date(d.getTime() + 8 * 3600000);
  const M = tw.getUTCMonth() + 1;
  const D = tw.getUTCDate();
  const h = tw.getUTCHours();
  const m = String(tw.getUTCMinutes()).padStart(2, '0');
  return `${M}/${D} ${h}:${m}`;
}

function shortBranch(name) {
  if (!name) return '';
  return name
    .replace(/^[A-Z]\d{1,2}/, '')
    .replace(/\(服務時間至\d+時\)/, '')
    .trim();
}

// --- Alert building (for daily/通知 mode) ---

function buildAlerts(data) {
  const today = getToday();
  const alerts = [];

  for (const account of (data.accounts || [])) {
    if (account.status !== 'ok') continue;

    for (const book of (account.borrowed || [])) {
      if (!book.dueDate) continue;
      const days = daysUntil(book.dueDate);

      if (days < 0) {
        alerts.push({
          type: 'overdue',
          account: account.label,
          title: book.title,
          date: book.dueDate,
          detail: `逾期 ${Math.abs(days)} 天`,
        });
      } else if (days <= 2) {
        alerts.push({
          type: 'due-soon',
          account: account.label,
          title: book.title,
          date: book.dueDate,
          detail: days === 0 ? '今天到期' : `剩 ${days} 天`,
        });
      }
    }

    for (const res of (account.reservations || [])) {
      if (!res.isReady || !res.pickupDeadline) continue;
      const daysLeft = Math.ceil((new Date(res.pickupDeadline) - today) / 86400000);

      if (daysLeft >= 4) {
        alerts.push({
          type: 'pickup-ready',
          account: account.label,
          title: res.title,
          branch: res.pickupBranch,
          date: res.pickupDeadline,
        });
      } else if (daysLeft <= 2) {
        alerts.push({
          type: 'pickup-expiring',
          account: account.label,
          title: res.title,
          branch: res.pickupBranch,
          date: res.pickupDeadline,
        });
      }
    }
  }

  return alerts;
}

function formatAlertMessage(alerts) {
  const groups = {
    overdue: { label: '已逾期', emoji: '🔴', items: [] },
    'due-soon': { label: '即將到期', emoji: '📕', items: [] },
    'pickup-ready': { label: '預約書到館', emoji: '📗', items: [] },
    'pickup-expiring': { label: '預約書即將截止', emoji: '📙', items: [] },
  };

  for (const a of alerts) {
    if (groups[a.type]) groups[a.type].items.push(a);
  }

  let body = '📚 每日檢查報告\n───────\n\n';
  body += getTodayStatusLine() + '\n\n';
  for (const g of Object.values(groups)) {
    if (g.items.length === 0) continue;
    body += `${g.emoji} ${g.label}（${g.items.length} 本）\n\n`;
    for (const a of g.items) {
      body += `${a.account}\n`;
      body += `${a.title}\n`;
      if (a.branch) {
        body += `${shortBranch(a.branch)}｜截止 ${shortDate(a.date)}\n`;
      } else if (a.detail) {
        body += `到期 ${shortDate(a.date)}｜${a.detail}\n`;
      } else {
        body += `到期 ${shortDate(a.date)}\n`;
      }
      body += '\n';
    }
  }
  return body.trim();
}

// --- Summary (總覽) ---

function buildSummary(data) {
  let msg = '📚 借閱總覽\n───────\n\n';
  msg += getTodayStatusLine() + '\n\n';

  for (const account of (data.accounts || [])) {
    if (account.status !== 'ok') {
      msg += `【${account.label}】❌ 更新失敗\n\n`;
      continue;
    }

    const borrowed = account.borrowed || [];
    const reservations = account.reservations || [];
    const ready = reservations.filter(r => r.isReady);
    const sorted = borrowed.filter(b => b.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const nearest = sorted[0];

    msg += `【${account.label}】\n`;
    msg += `📖 借閱 ${borrowed.length} 本\n`;
    if (nearest) {
      const days = daysUntil(nearest.dueDate);
      const label = days < 0 ? `逾期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `剩 ${days} 天`;
      msg += `📅 最近到期 ${shortDate(nearest.dueDate)}（${label}）\n`;
    }
    msg += `📋 預約 ${reservations.length} 本`;
    if (ready.length > 0) msg += `，${ready.length} 本可取`;
    msg += '\n\n';
  }

  msg += `🕐 ${shortTime(data.lastUpdated)} 更新`;
  return msg;
}

// --- Borrowed (借閱) — 近 5 天到期的書 ---

function buildBorrowedSoon(data) {
  const books = [];

  for (const account of (data.accounts || [])) {
    if (account.status !== 'ok') continue;
    for (const book of (account.borrowed || [])) {
      const days = daysUntil(book.dueDate);
      if (days !== null && days <= 5) {
        books.push({ ...book, accountLabel: account.label, days });
      }
    }
  }

  books.sort((a, b) => a.days - b.days);

  if (books.length === 0) {
    return `📖 近 5 天到期\n───────\n\n✅ 沒有近期到期的書籍\n\n🕐 ${shortTime(data.lastUpdated)} 更新`;
  }

  let msg = `📖 近 5 天到期（${books.length} 本）\n───────\n\n`;

  for (const b of books) {
    const label = b.days < 0 ? `⚠️ 逾期 ${Math.abs(b.days)} 天` : b.days === 0 ? '⚠️ 今天到期' : `剩 ${b.days} 天`;
    const renew = b.canRenew ? '可續借' : '不可續借';
    msg += `${label}｜${shortDate(b.dueDate)}\n`;
    msg += `${b.title}\n`;
    msg += `${b.accountLabel}｜續借 ${b.renewalCount ?? 0} 次｜${renew}\n\n`;
  }

  msg += `🕐 ${shortTime(data.lastUpdated)} 更新`;
  return msg;
}

// --- Reservations (預約) — 可領取 + 調閱中 ---

function buildReservations(data) {
  const ready = [];
  const inTransit = [];

  for (const account of (data.accounts || [])) {
    if (account.status !== 'ok') continue;
    for (const res of (account.reservations || [])) {
      if (res.isReady) {
        ready.push(res);
      } else if (res.isInTransit) {
        inTransit.push(res);
      }
    }
  }

  ready.sort((a, b) => (a.pickupDeadline || '').localeCompare(b.pickupDeadline || ''));

  if (ready.length === 0 && inTransit.length === 0) {
    return `📋 預約書狀態\n───────\n\n✅ 沒有可領取或調閱中的書\n\n🕐 ${shortTime(data.lastUpdated)} 更新`;
  }

  let msg = '📋 預約書狀態\n───────\n\n';

  if (ready.length > 0) {
    msg += `📗 可領取（${ready.length} 本）\n\n`;
    for (const r of ready) {
      const branch = shortBranch(r.pickupBranch);
      let deadlineInfo = r.pickupDeadline ? `截止 ${shortDate(r.pickupDeadline)}` : '';
      // 如果截止日休館，顯示最後取書日
      if (r.pickupDeadline && isClosed(r.pickupDeadline)) {
        const lastDay = getLastOpenDay(r.pickupDeadline);
        deadlineInfo += `（⚠️ 休館，最後取書 ${shortDate(lastDay)}）`;
      }
      msg += `${r.title}\n`;
      msg += `${[branch, deadlineInfo].filter(Boolean).join('｜')}\n\n`;
    }
  }

  if (inTransit.length > 0) {
    msg += `📦 調閱中（${inTransit.length} 本）\n\n`;
    for (const r of inTransit) {
      const branch = shortBranch(r.pickupBranch);
      msg += `${r.title}\n`;
      if (branch) msg += `${branch}\n`;
      msg += '\n';
    }
  }

  msg += `🕐 ${shortTime(data.lastUpdated)} 更新`;
  return msg;
}

// --- Return (還書) ---
// 判斷是否「不能續借」：canRenew === false 或有人預約排隊
function isEffectivelyNonRenewable(book) {
  return !book.canRenew || (book.reservationCount > 0);
}

function buildReturnAdvice(data) {
  let msg = '📕 還書建議\n───────\n\n';

  for (const account of (data.accounts || [])) {
    if (account.status !== 'ok') continue;

    const label = account.label;
    const limit = account.borrowLimit || DEFAULT_BORROW_LIMIT;
    const borrowed = account.borrowed || [];
    const reservations = account.reservations || [];

    // 1. 可以拿的預約書
    const readyBooks = reservations.filter(r => r.isReady);

    // 2. 近 2 天到期且不能續借的書
    const dueSoon = borrowed.filter(b => {
      const days = daysUntil(b.dueDate);
      return days !== null && days <= 2 && isEffectivelyNonRenewable(b);
    }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // 3. 計算是否超限：拿完預約書後的數量
    const currentCount = borrowed.length;
    const projectedCount = currentCount + readyBooks.length;
    const overLimit = projectedCount > limit;

    msg += `【${label}】${currentCount}/${limit} 本\n`;

    if (readyBooks.length > 0) {
      msg += `\n📗 可取預約書（${readyBooks.length} 本）\n`;
      for (const r of readyBooks) {
        const branch = shortBranch(r.pickupBranch);
        const deadline = r.pickupDeadline ? `截止 ${shortDate(r.pickupDeadline)}` : '';
        msg += `• ${r.title}`;
        if (branch || deadline) msg += `（${[branch, deadline].filter(Boolean).join('｜')}）`;
        msg += '\n';
      }
    }

    if (dueSoon.length > 0) {
      msg += `\n📕 近 2 天到期・不可續借（${dueSoon.length} 本）\n`;
      for (const b of dueSoon) {
        const days = daysUntil(b.dueDate);
        const dueLabel = days < 0 ? `逾期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `剩 ${days} 天`;
        const reason = b.reservationCount > 0 ? '有人預約' : '不可續借';
        msg += `• ${b.title}（${dueLabel}｜${reason}）\n`;
      }
    }

    // 4. 超限時，推薦額外歸還的書（不限 2 天，從最近到期的不可續借書開始）
    if (overLimit) {
      const excess = projectedCount - limit;
      msg += `\n⚠️ 取完預約書會超限 ${excess} 本\n`;

      // 從所有不可續借的書中挑（排除已在 dueSoon 列出的）
      const dueSoonTitles = new Set(dueSoon.map(b => b.title));
      const extraCandidates = borrowed
        .filter(b => b.dueDate && isEffectivelyNonRenewable(b) && !dueSoonTitles.has(b.title))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      const needed = Math.max(0, excess - dueSoon.length);
      const extras = extraCandidates.slice(0, needed);

      if (extras.length > 0) {
        msg += `📌 建議額外歸還（${extras.length} 本）\n`;
        for (const b of extras) {
          msg += `• ${b.title}（${shortDate(b.dueDate)} 到期）\n`;
        }
      }

      if (dueSoon.length + extras.length < excess) {
        const remaining = excess - dueSoon.length - extras.length;
        msg += `⚠️ 還需自行選擇 ${remaining} 本歸還\n`;
      }
    } else if (readyBooks.length === 0 && dueSoon.length === 0) {
      msg += '✅ 沒有需要處理的書\n';
    }

    msg += '\n';
  }

  msg += `🕐 ${shortTime(data.lastUpdated)} 更新`;
  return msg;
}

// --- Closure status (開館資訊) ---

function buildClosureStatus() {
  return buildClosureCalendar();
}

// --- Dispatch functions ---

async function notify(message, subject, label) {
  await sendLine(message, label);
  await trySendEmail(subject, message, label);
}

async function notifyDaily(data) {
  const alerts = buildAlerts(data);

  if (alerts.length > 0) {
    const message = formatAlertMessage(alerts);
    await notify(message, `圖書館提醒：${alerts.length} 項待處理事項`, 'daily');
  } else {
    const message = `📚 每日檢查完成\n\n${getTodayStatusLine()}\n\n✅ 今天沒有需要通知的事項`;
    await notify(message, '圖書館每日檢查：無待處理事項', 'daily');
  }
}

async function notifySummary(data) {
  await notify(buildSummary(data), '圖書館借閱總覽', 'summary');
}

async function notifyBorrowed(data) {
  await notify(buildBorrowedSoon(data), '圖書館：近期到期書籍', 'borrowed');
}

async function notifyReservations(data) {
  await notify(buildReservations(data), '圖書館：預約書狀態', 'reservations');
}

async function notifyReturn(data) {
  await notify(buildReturnAdvice(data), '圖書館：還書建議', 'return');
}

async function notifyClosureStatus() {
  await notify(buildClosureStatus(), '圖書館：開館資訊', 'hours');
}

async function sendLine(message, label) {
  const lineConfig = readLineConfig();
  if (!lineConfig) return;
  try {
    await sendLineMessage(lineConfig.token, lineConfig.targetId, message);
    console.log(`[notifier] LINE ${label} sent`);
  } catch (err) {
    console.error(`[notifier] Failed to send LINE ${label}:`, err.message);
  }
}

async function trySendEmail(subject, body, label) {
  const config = readEmailConfig();
  if (!config?.enabled) return;
  try {
    await sendEmail(config, subject, body);
    console.log(`[notifier] Email ${label} sent`);
  } catch (err) {
    console.error(`[notifier] Failed to send email ${label}:`, err.message);
  }
}

// --- Email ---

async function sendEmail(config, subject, body) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.senderEmail, pass: config.senderAppPassword },
  });

  await transporter.sendMail({
    from: `圖書館儀表板 <${config.senderEmail}>`,
    to: config.recipientEmail,
    subject,
    text: body,
  });
}

module.exports = {
  notifyDaily,
  notifySummary,
  notifyBorrowed,
  notifyReservations,
  notifyReturn,
  notifyClosureStatus,
  // Exported for testing
  buildAlerts,
  buildReservations,
  buildReturnAdvice,
  buildSummary,
};
