require('dotenv').config();
const nodemailer = require('nodemailer');

function readEmailConfig() {
  if (process.env.EMAIL_ENABLED !== 'true') return null;
  const sender = process.env.EMAIL_SENDER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  const recipient = process.env.EMAIL_RECIPIENT;
  if (!sender || !pass || !recipient) return null;
  return { enabled: true, senderEmail: sender, senderAppPassword: pass, recipientEmail: recipient };
}


async function checkAndNotify(data) {
  const config = readEmailConfig();
  if (!config || !config.enabled) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const twoDaysLater = new Date(today);
  twoDaysLater.setDate(twoDaysLater.getDate() + 2);

  const alerts = [];

  for (const account of (data.accounts || [])) {
    if (account.status !== 'ok') continue;

    // 1) Overdue books  2) Books due within 2 days
    for (const book of (account.borrowed || [])) {
      if (!book.dueDate) continue;
      const due = new Date(book.dueDate);
      const daysUntilDue = Math.floor((due - today) / 86400000);

      if (daysUntilDue < 0) {
        alerts.push({
          type: 'overdue',
          key: `overdue:${account.id}:${book.title}:${book.dueDate}`,
          text: `🔴 【已逾期】${account.label} - 「${book.title}」到期日：${book.dueDate}（逾期 ${Math.abs(daysUntilDue)} 天）`,
        });
      } else if (daysUntilDue <= 2) {
        alerts.push({
          type: 'due-soon',
          key: `due:${account.id}:${book.title}:${book.dueDate}`,
          text: `📕 【即將到期】${account.label} - 「${book.title}」到期日：${book.dueDate}`,
        });
      }
    }

    // 2) Reservation just arrived (isReady + deadline >= 4 days away = first day)
    // 3) Reservation pickup deadline within 2 days
    for (const res of (account.reservations || [])) {
      if (!res.isReady || !res.pickupDeadline) continue;
      const deadline = new Date(res.pickupDeadline);
      const daysLeft = Math.ceil((deadline - today) / 86400000);

      if (daysLeft >= 4) {
        // First day arrival — deadline ~5 days away
        alerts.push({
          type: 'pickup-ready',
          key: `ready:${account.id}:${res.title}:${res.pickupDeadline}`,
          text: `📗 【預約書到館】${account.label} - 「${res.title}」取書館：${res.pickupBranch || '未知'}，請於 ${res.pickupDeadline} 前領取`,
        });
      } else if (daysLeft <= 2) {
        // Pickup deadline approaching
        alerts.push({
          type: 'pickup-expiring',
          key: `expire:${account.id}:${res.title}:${res.pickupDeadline}`,
          text: `📙 【預約書領取即將截止】${account.label} - 「${res.title}」取書館：${res.pickupBranch || '未知'}，截止日：${res.pickupDeadline}`,
        });
      }
    }
  }

  if (alerts.length === 0) return;

  // Build email with all current alerts
  const overdueAlerts = alerts.filter(a => a.type === 'overdue');
  const dueAlerts = alerts.filter(a => a.type === 'due-soon');
  const readyAlerts = alerts.filter(a => a.type === 'pickup-ready');
  const expiringAlerts = alerts.filter(a => a.type === 'pickup-expiring');

  let body = '台北市立圖書館借閱提醒\n';
  body += '═══════════════════════\n\n';

  if (overdueAlerts.length > 0) {
    body += `【已逾期的書籍】（${overdueAlerts.length} 本）\n`;
    body += overdueAlerts.map(a => '  • ' + a.text).join('\n') + '\n\n';
  }
  if (dueAlerts.length > 0) {
    body += `【即將到期的書籍】（${dueAlerts.length} 本）\n`;
    body += dueAlerts.map(a => '  • ' + a.text).join('\n') + '\n\n';
  }
  if (readyAlerts.length > 0) {
    body += `【預約書到館通知】（${readyAlerts.length} 本）\n`;
    body += readyAlerts.map(a => '  • ' + a.text).join('\n') + '\n\n';
  }
  if (expiringAlerts.length > 0) {
    body += `【預約書領取即將截止】（${expiringAlerts.length} 本）\n`;
    body += expiringAlerts.map(a => '  • ' + a.text).join('\n') + '\n\n';
  }

  body += '---\n此信由圖書館借閱儀表板自動發送';

  const subject = `圖書館提醒：${alerts.length} 項待處理事項`;

  try {
    await sendEmail(config, subject, body);
    console.log(`[notifier] Email sent with ${alerts.length} alerts`);
  } catch (err) {
    console.error('[notifier] Failed to send email:', err.message);
  }
}

async function sendEmail(config, subject, body) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.senderEmail,
      pass: config.senderAppPassword,
    },
  });

  await transporter.sendMail({
    from: `圖書館儀表板 <${config.senderEmail}>`,
    to: config.recipientEmail,
    subject,
    text: body,
  });
}

module.exports = { checkAndNotify };
