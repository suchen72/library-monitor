require('dotenv').config();
const nodemailer = require('nodemailer');
const { readLineConfig, sendLineMessage } = require('./lineNotifier');

// --- Email config ---

function readEmailConfig() {
  if (process.env.EMAIL_ENABLED !== 'true') return null;
  const sender = process.env.EMAIL_SENDER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  const recipient = process.env.EMAIL_RECIPIENT;
  if (!sender || !pass || !recipient) return null;
  return { enabled: true, senderEmail: sender, senderAppPassword: pass, recipientEmail: recipient };
}

// --- Alert building ---

function buildAlerts(data) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const alerts = [];

  for (const account of (data.accounts || [])) {
    if (account.status !== 'ok') continue;

    for (const book of (account.borrowed || [])) {
      if (!book.dueDate) continue;
      const due = new Date(book.dueDate);
      const daysUntilDue = Math.floor((due - today) / 86400000);

      if (daysUntilDue < 0) {
        alerts.push({
          type: 'overdue',
          text: `🔴 【已逾期】${account.label} -「${book.title}」到期日：${book.dueDate}（逾期 ${Math.abs(daysUntilDue)} 天）`,
        });
      } else if (daysUntilDue <= 2) {
        alerts.push({
          type: 'due-soon',
          text: `📕 【即將到期】${account.label} -「${book.title}」到期日：${book.dueDate}`,
        });
      }
    }

    for (const res of (account.reservations || [])) {
      if (!res.isReady || !res.pickupDeadline) continue;
      const deadline = new Date(res.pickupDeadline);
      const daysLeft = Math.ceil((deadline - today) / 86400000);

      if (daysLeft >= 4) {
        alerts.push({
          type: 'pickup-ready',
          text: `📗 【預約書到館】${account.label} -「${res.title}」取書館：${res.pickupBranch || '未知'}，請於 ${res.pickupDeadline} 前領取`,
        });
      } else if (daysLeft <= 2) {
        alerts.push({
          type: 'pickup-expiring',
          text: `📙 【預約書領取即將截止】${account.label} -「${res.title}」取書館：${res.pickupBranch || '未知'}，截止日：${res.pickupDeadline}`,
        });
      }
    }
  }

  return alerts;
}

function formatAlertMessage(alerts) {
  const overdueAlerts = alerts.filter(a => a.type === 'overdue');
  const dueAlerts = alerts.filter(a => a.type === 'due-soon');
  const readyAlerts = alerts.filter(a => a.type === 'pickup-ready');
  const expiringAlerts = alerts.filter(a => a.type === 'pickup-expiring');

  let body = '📚 圖書館每日檢查報告\n';
  body += '═══════════════════════\n\n';

  if (overdueAlerts.length > 0) {
    body += `【已逾期的書籍】（${overdueAlerts.length} 本）\n`;
    body += overdueAlerts.map(a => a.text).join('\n') + '\n\n';
  }
  if (dueAlerts.length > 0) {
    body += `【即將到期的書籍】（${dueAlerts.length} 本）\n`;
    body += dueAlerts.map(a => a.text).join('\n') + '\n\n';
  }
  if (readyAlerts.length > 0) {
    body += `【預約書到館通知】（${readyAlerts.length} 本）\n`;
    body += readyAlerts.map(a => a.text).join('\n') + '\n\n';
  }
  if (expiringAlerts.length > 0) {
    body += `【預約書領取即將截止】（${expiringAlerts.length} 本）\n`;
    body += expiringAlerts.map(a => a.text).join('\n') + '\n\n';
  }

  return body.trim();
}

// --- Summary building ---

function buildSummary(data) {
  let msg = '📚 借閱總覽\n';
  msg += '═══════════════════════\n\n';

  for (const account of (data.accounts || [])) {
    if (account.status !== 'ok') {
      msg += `【${account.label}】❌ 更新失敗\n\n`;
      continue;
    }

    const borrowed = account.borrowed || [];
    const reservations = account.reservations || [];
    const ready = reservations.filter(r => r.isReady);

    // Nearest due date
    const sorted = borrowed.filter(b => b.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const nearest = sorted[0];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    msg += `【${account.label}】\n`;
    msg += `  📖 借閱 ${borrowed.length} 本`;
    if (nearest) {
      const days = Math.floor((new Date(nearest.dueDate) - today) / 86400000);
      const label = days < 0 ? `逾期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `剩 ${days} 天`;
      msg += `，最近到期：${nearest.dueDate}（${label}）`;
    }
    msg += '\n';

    msg += `  📋 預約 ${reservations.length} 本`;
    if (ready.length > 0) msg += `，${ready.length} 本可領取`;
    msg += '\n\n';
  }

  const time = data.lastUpdated
    ? new Date(data.lastUpdated).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    : '未知';
  msg += `更新時間：${time}`;

  return msg;
}

// --- Dispatch functions ---

async function notifyDaily(data) {
  const alerts = buildAlerts(data);
  const lineConfig = readLineConfig();
  const emailConfig = readEmailConfig();

  if (alerts.length > 0) {
    const message = formatAlertMessage(alerts);
    const subject = `圖書館提醒：${alerts.length} 項待處理事項`;

    if (emailConfig?.enabled) {
      try {
        await sendEmail(emailConfig, subject, message);
        console.log(`[notifier] Email sent with ${alerts.length} alerts`);
      } catch (err) {
        console.error('[notifier] Failed to send email:', err.message);
      }
    }

    if (lineConfig) {
      try {
        await sendLineMessage(lineConfig.token, lineConfig.targetId, message);
        console.log(`[notifier] LINE sent with ${alerts.length} alerts`);
      } catch (err) {
        console.error('[notifier] Failed to send LINE:', err.message);
      }
    }
  } else {
    // No alerts — still notify so user knows the check ran
    const noAlertMsg = '📚 圖書館每日檢查完成\n\n✅ 今天沒有需要通知的事項。';

    if (lineConfig) {
      try {
        await sendLineMessage(lineConfig.token, lineConfig.targetId, noAlertMsg);
        console.log('[notifier] LINE sent: no alerts today');
      } catch (err) {
        console.error('[notifier] Failed to send LINE:', err.message);
      }
    }
  }
}

async function notifySummary(data) {
  const message = buildSummary(data);
  const lineConfig = readLineConfig();

  if (lineConfig) {
    try {
      await sendLineMessage(lineConfig.token, lineConfig.targetId, message);
      console.log('[notifier] LINE summary sent');
    } catch (err) {
      console.error('[notifier] Failed to send LINE summary:', err.message);
    }
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

module.exports = { notifyDaily, notifySummary, buildAlerts, buildSummary };
