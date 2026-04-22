// Cloudflare Worker: LINE Webhook → instant KV response or GitHub Actions trigger
// Query modes (總覽/借閱/預約/還書) read cached data from KV and reply instantly.
// Scrape modes (更新/通知) trigger GitHub Actions to refresh data.

import { buildSummary, buildBorrowedSoon, buildReservations, buildReturnAdvice, buildClosureStatus } from './formatters.js';

const WORKFLOW_FILE = 'scrape.yml';
const MAX_TEXT_LENGTH = 5000;

// Keyword → mode mapping (first match wins, order matters)
const KEYWORD_MODES = [
  { keywords: ['開館', '開門', 'hours', 'open'], mode: 'hours' },
  { keywords: ['更新', 'refresh'], mode: 'refresh' },
  { keywords: ['總覽', 'summary'], mode: 'summary' },
  { keywords: ['通知', '檢查', 'daily'], mode: 'daily' },
  { keywords: ['借閱', 'borrowed'], mode: 'borrowed' },
  { keywords: ['預約', 'reservations'], mode: 'reservations' },
  { keywords: ['還書', 'return'], mode: 'return' },
  { keywords: ['續借', 'renew'], mode: 'renew' },
];
const DEFAULT_MODE = 'summary';

// Modes that read from KV and reply instantly
const KV_BUILDERS = {
  summary: buildSummary,
  borrowed: buildBorrowedSoon,
  reservations: buildReservations,
  return: buildReturnAdvice,
};

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const body = await request.text();
      const signature = request.headers.get('x-line-signature');
      if (!await verifySignature(env.LINE_CHANNEL_SECRET, body, signature)) {
        return new Response('Invalid signature', { status: 403 });
      }

      const parsed = JSON.parse(body);
      for (const event of (parsed.events || [])) {
        if (event.type !== 'message' || event.message?.type !== 'text') continue;

        // userId 白名單
        // WHITELIST_ENABLED: "true"(預設) 啟用，"false" 關閉
        // 可在 Cloudflare Dashboard → Workers → Settings → Variables 切換
        const userId = event.source?.userId;
        if (env.WHITELIST_ENABLED !== 'false') {
          const allowedIds = (env.ALLOWED_USER_IDS || '').split(',').filter(Boolean);
          if (!allowedIds.length || !allowedIds.includes(userId)) {
            await replyMessage(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken,
              '未授權，請聯繫管理員');
            continue;
          }
        }

        const text = event.message.text.trim().toLowerCase();

        // Determine mode from keyword
        let mode = null;
        for (const { keywords, mode: m } of KEYWORD_MODES) {
          if (keywords.some(kw => text.includes(kw))) {
            mode = m;
            break;
          }
        }

        if (mode === null && text.length <= 10) {
          mode = DEFAULT_MODE;
        }

        if (!mode) continue;

        // 「開館」不需要 KV 資料，直接計算回覆
        if (mode === 'hours') {
          const message = buildClosureStatus();
          await replyMessage(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, message);
          continue;
        }

        // KV-based instant reply
        if (KV_BUILDERS[mode]) {
          const data = await env.LIBRARY_DATA.get('library-data', 'json');
          if (!data) {
            await replyMessage(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken,
              '⚠️ 尚無資料，請先發送「更新」來觸發第一次資料抓取。');
            continue;
          }
          const message = KV_BUILDERS[mode](data);
          await replyMessage(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, message);
          continue;
        }

        // GitHub Actions trigger (daily / refresh / renew)
        const ghMode = mode === 'refresh' ? 'summary' : mode === 'renew' ? 'renew' : 'daily';
        const githubRepo = env.GITHUB_REPO || 'suchen72/library-monitor';
        const ghRes = await fetch(
          `https://api.github.com/repos/${githubRepo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.GITHUB_PAT}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'library-monitor-line-bot',
            },
            body: JSON.stringify({
              ref: 'main',
              inputs: { mode: ghMode },
            }),
          }
        );

        const modeLabel = { daily: '每日檢查', refresh: '更新資料', renew: '續借所有可續借的書' }[mode] || mode;
        const replyText = ghRes.ok
          ? `已觸發「${modeLabel}」，約 3 分鐘後回報結果 📚`
          : `觸發失敗（${ghRes.status}），請稍後再試`;

        await replyMessage(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, replyText);
      }

      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error('Worker error:', err);
      return new Response('OK', { status: 200 });
    }
  },
};

async function replyMessage(token, replyToken, text) {
  // Split long messages (LINE limit: 5000 chars per message, max 5 messages per reply)
  const messages = [];
  for (let i = 0; i < text.length; i += MAX_TEXT_LENGTH) {
    messages.push({ type: 'text', text: text.substring(i, i + MAX_TEXT_LENGTH) });
  }

  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: messages.slice(0, 5),
    }),
  });
}

async function verifySignature(channelSecret, body, signature) {
  if (!signature || !channelSecret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));

  // 用 constant-time 比較，避免 timing attack：
  // 普通的 === 遇到第一個不同字元就停止，攻擊者理論上可以透過
  // 測量回應時間來逐字元猜測正確的 signature。
  // 這裡改用 XOR 逐 byte 比較，不管哪裡不同都跑完全部，
  // 所以回應時間不會洩漏「猜對了幾個字元」。
  const expectedBytes = new Uint8Array(sig);
  let sigBytes;
  try {
    sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  } catch {
    return false; // base64 decode 失敗
  }
  if (expectedBytes.length !== sigBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= expectedBytes[i] ^ sigBytes[i]; // XOR：相同為 0，不同為非 0
  }
  return diff === 0; // 全部 byte 都相同才是 0
}
