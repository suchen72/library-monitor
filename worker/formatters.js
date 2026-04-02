// ES module port of pure formatting functions from src/notifier.js
// Keep in sync with src/notifier.js when changing notification formats.

function getBorrowLimit(cardNumber) {
  if (cardNumber && cardNumber.toUpperCase().startsWith('FA')) return 30;
  return 25;
}

// --- Helpers ---

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

// --- Build functions ---

export function buildSummary(data) {
  let msg = '📚 借閱總覽\n───────\n\n';

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

export function buildBorrowedSoon(data) {
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

export function buildReservations(data) {
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
      const deadline = r.pickupDeadline ? `截止 ${shortDate(r.pickupDeadline)}` : '';
      const branch = shortBranch(r.pickupBranch);
      msg += `${r.title}\n`;
      msg += `${[branch, deadline].filter(Boolean).join('｜')}\n\n`;
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

export function buildReturnAdvice(data) {
  let msg = '📕 還書建議\n───────\n\n';
  let hasWarning = false;
  const returnBooks = [];

  for (const account of (data.accounts || [])) {
    if (account.status !== 'ok') continue;

    const label = account.label;
    const limit = getBorrowLimit(account.cardNumber);
    const borrowed = account.borrowed || [];
    const reservations = account.reservations || [];

    const A = borrowed.filter(b => {
      const days = daysUntil(b.dueDate);
      return days !== null && days <= 0;
    }).length;

    const B = reservations.filter(r => r.isReady).length;

    const currentCount = borrowed.length;
    const projectedCount = currentCount - A + B;
    const overLimit = projectedCount > limit;

    msg += `【${label}】${currentCount}/${limit} 本`;
    msg += overLimit ? ' ⚠️\n' : ' ✅\n';
    msg += `到期 ${A} 本｜待取 ${B} 本\n`;
    msg += `預計 ${projectedCount} 本`;

    if (overLimit) {
      hasWarning = true;
      const excess = projectedCount - limit;
      msg += `｜超 ${excess} 本\n\n`;

      const nonRenewable = borrowed
        .filter(b => !b.canRenew && b.dueDate)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      for (const b of nonRenewable.slice(0, excess)) {
        const days = daysUntil(b.dueDate);
        const dueLabel = days < 0 ? `逾期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `${shortDate(b.dueDate)} 到期`;
        returnBooks.push({ title: b.title, dueLabel, accountLabel: label });
      }

      if (nonRenewable.length < excess) {
        msg += `⚠️ 請自行選擇 ${excess - nonRenewable.length} 本歸還\n`;
      }
    } else {
      msg += '\n';
    }
    msg += '\n';
  }

  if (returnBooks.length > 0) {
    msg += `📌 建議歸還（${returnBooks.length} 本）\n`;
    for (const b of returnBooks) {
      msg += `• ${b.title}（${b.dueLabel}）\n`;
    }
    msg += '\n';
  }

  if (!hasWarning) {
    msg += '✅ 都在上限內，不需額外還書\n\n';
  }

  msg += `🕐 ${shortTime(data.lastUpdated)} 更新`;
  return msg;
}
