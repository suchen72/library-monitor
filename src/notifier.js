require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const SENT_LOG_PATH = path.join(__dirname, '..', 'data', 'notified.json');

function readEmailConfig() {
  if (process.env.EMAIL_ENABLED !== 'true') return null;
  const sender = process.env.EMAIL_SENDER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  const recipient = process.env.EMAIL_RECIPIENT;
  if (!sender || !pass || !recipient) return null;
  return { enabled: true, senderEmail: sender, senderAppPassword: pass, recipientEmail: recipient };
}

// Track which notifications we've already sent today (avoid duplicates)
function readSentLog() {
  if (!fs.existsSync(SENT_LOG_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(SENT_LOG_PATH, 'utf8')); } catch { return {}; }
}

function writeSentLog(log) {
  fs.writeFileSync(SENT_LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "2026-03-26"
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

    // 1) Books due within 2 days
    for (const book of (account.borrowed || [])) {
      if (!book.dueDate) continue;
      const due = new Date(book.dueDate);
      if (due <= twoDaysLater) {
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

  // Deduplicate: only send alerts not yet sent today
  const sentLog = readSentLog();
  const todayStr = todayKey();
  const todaySent = sentLog[todayStr] || [];
  const newAlerts = alerts.filter(a => !todaySent.includes(a.key));

  if (newAlerts.length === 0) {
    console.log('[notifier] All alerts already sent today, skipping');
    return;
  }

  // Build email
  const dueAlerts = newAlerts.filter(a => a.type === 'due-soon');
  const readyAlerts = newAlerts.filter(a => a.type === 'pickup-ready');
  const expiringAlerts = newAlerts.filter(a => a.type === 'pickup-expiring');

  let body = '台北市立圖書館借閱提醒\n';
  body += '═══════════════════════\n\n';

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

  const subject = `圖書館提醒：${newAlerts.length} 項待處理事項`;

  try {
    await sendEmail(config, subject, body);
    // Record sent alerts
    sentLog[todayStr] = [...todaySent, ...newAlerts.map(a => a.key)];
    // Clean up old entries (keep 7 days)
    for (const key of Object.keys(sentLog)) {
      if (key < new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)) {
        delete sentLog[key];
      }
    }
    writeSentLog(sentLog);
    console.log(`[notifier] Email sent with ${newAlerts.length} alerts`);
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
