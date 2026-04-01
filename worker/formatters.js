// ES module port of pure formatting functions from src/notifier.js
// Keep in sync with src/notifier.js when changing notification formats.

const BORROW_LIMITS = {
  sclin: 25,
  tomky: 25,
  family: 30,
};
const DEFAULT_LIMIT = 25;

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr) - getToday()) / 86400000);
}

function formatTime(iso) {
  if (!iso) return '未知';
  return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

export function buildSummary(data) {
  let msg = '📚 借閱總覽\n═══════════════════════\n\n';

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
    msg += `  📖 借閱 ${borrowed.length} 本`;
    if (nearest) {
      const days = daysUntil(nearest.dueDate);
      const label = days < 0 ? `逾期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `剩 ${days} 天`;
      msg += `，最近到期：${nearest.dueDate}（${label}）`;
    }
    msg += '\n';
    msg += `  📋 預約 ${reservations.length} 本`;
    if (ready.length > 0) msg += `，${ready.length} 本可領取`;
    msg += '\n\n';
  }

  msg += `更新時間：${formatTime(data.lastUpdated)}`;
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
    return `📖 近 5 天到期的書\n═══════════════════════\n\n✅ 沒有近期到期的書籍。\n\n更新時間：${formatTime(data.lastUpdated)}`;
  }

  let msg = `📖 近 5 天到期的書（${books.length} 本）\n═══════════════════════\n\n`;

  for (const b of books) {
    const label = b.days < 0 ? `⚠️ 逾期 ${Math.abs(b.days)} 天` : b.days === 0 ? '⚠️ 今天到期' : `剩 ${b.days} 天`;
    const renew = b.canRenew ? '可續借' : '不可續借';
    msg += `${label}｜${b.dueDate}\n`;
    msg += `  ${b.title}\n`;
    msg += `  ${b.accountLabel}｜已續借 ${b.renewalCount ?? 0} 次｜${renew}\n\n`;
  }

  msg += `更新時間：${formatTime(data.lastUpdated)}`;
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
    return `📋 預約書狀態\n═══════════════════════\n\n✅ 目前沒有可領取或調閱中的預約書。\n\n更新時間：${formatTime(data.lastUpdated)}`;
  }

  let msg = '📋 預約書狀態\n═══════════════════════\n\n';

  if (ready.length > 0) {
    msg += `【可領取】（${ready.length} 本）\n`;
    for (const r of ready) {
      const deadline = r.pickupDeadline ? `截止 ${r.pickupDeadline}` : '';
      const branch = r.pickupBranch || '';
      msg += `  📗 ${r.title}\n`;
      msg += `     ${branch}${deadline ? '｜' + deadline : ''}\n\n`;
    }
  }

  if (inTransit.length > 0) {
    msg += `【調閱中】（${inTransit.length} 本）\n`;
    for (const r of inTransit) {
      const branch = r.pickupBranch || '';
      msg += `  📦 ${r.title}\n`;
      if (branch) msg += `     ${branch}\n`;
      msg += '\n';
    }
  }

  msg += `更新時間：${formatTime(data.lastUpdated)}`;
  return msg;
}

export function buildReturnAdvice(data) {
  let msg = '📕 還書建議\n═══════════════════════\n\n';
  let hasWarning = false;

  for (const account of (data.accounts || [])) {
    if (account.status !== 'ok') continue;

    const label = account.label;
    const limit = BORROW_LIMITS[label.toLowerCase()] || DEFAULT_LIMIT;
    const borrowed = account.borrowed || [];
    const reservations = account.reservations || [];

    const dueTodayBooks = borrowed.filter(b => {
      const days = daysUntil(b.dueDate);
      return days !== null && days <= 0;
    });
    const A = dueTodayBooks.length;

    const readyRes = reservations.filter(r => r.isReady);
    const B = readyRes.length;

    const currentCount = borrowed.length;
    const projectedCount = currentCount - A + B;
    const overLimit = projectedCount > limit;

    msg += `【${label}】`;
    msg += ` 現有 ${currentCount} 本｜上限 ${limit} 本\n`;
    msg += `  今日到期 ${A} 本，待領取 ${B} 本\n`;
    msg += `  還書後預計：${currentCount} - ${A} + ${B} = ${projectedCount} 本`;

    if (overLimit) {
      hasWarning = true;
      const excess = projectedCount - limit;
      msg += ` ⚠️ 超過上限 ${excess} 本！\n\n`;

      const nonRenewable = borrowed
        .filter(b => !b.canRenew && b.dueDate)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      const toReturn = nonRenewable.slice(0, excess);

      if (toReturn.length > 0) {
        msg += `  📌 建議優先歸還（不可續借，共 ${toReturn.length} 本）：\n`;
        for (const b of toReturn) {
          const days = daysUntil(b.dueDate);
          const dueLabel = days < 0 ? `逾期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `${b.dueDate}`;
          msg += `    • ${b.title}（${dueLabel}）\n`;
        }
      } else {
        msg += `  ⚠️ 沒有不可續借的書，請自行選擇 ${excess} 本歸還\n`;
      }
    } else {
      msg += ' ✅\n';
    }
    msg += '\n';
  }

  if (!hasWarning) {
    msg += '✅ 所有帳號都在借書上限內，不需要額外還書。';
  }

  msg += `\n\n更新時間：${formatTime(data.lastUpdated)}`;
  return msg;
}
