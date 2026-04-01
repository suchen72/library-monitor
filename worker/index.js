// Cloudflare Worker: LINE Webhook → GitHub Actions trigger
// Different keywords trigger different notification modes

const GITHUB_REPO = 'suchen72/library-monitor';
const WORKFLOW_FILE = 'scrape.yml';

// Keyword → mode mapping (extensible for future modes)
const KEYWORD_MODES = [
  { keywords: ['總覽', '更新', 'summary'], mode: 'summary' },
  { keywords: ['通知', '檢查', 'daily'], mode: 'daily' },
  { keywords: ['借閱', 'borrowed'], mode: 'borrowed' },
  { keywords: ['預約', 'reservations'], mode: 'reservations' },
  { keywords: ['還書', 'return'], mode: 'return' },
];
const DEFAULT_MODE = 'summary';

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

      const data = JSON.parse(body);
      for (const event of (data.events || [])) {
        if (event.type === 'message' && event.message?.type === 'text') {
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
            // Short unrecognized message — treat as default
            mode = DEFAULT_MODE;
          }

          if (mode) {
            const ghRes = await fetch(
              `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${env.GITHUB_PAT}`,
                  'Accept': 'application/vnd.github.v3+json',
                  'User-Agent': 'library-monitor-line-bot',
                },
                body: JSON.stringify({
                  ref: 'main',
                  inputs: { mode },
                }),
              }
            );

            const modeLabel = { summary: '借閱總覽', daily: '每日檢查', borrowed: '近期到期', reservations: '預約狀態', return: '還書建議' }[mode] || mode;
            const replyText = ghRes.ok
              ? `已觸發「${modeLabel}」，約 3 分鐘後回報結果 📚`
              : `觸發失敗（${ghRes.status}），請稍後再試`;

            await replyMessage(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, replyText);
          }
        }
      }

      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error('Worker error:', err);
      return new Response('OK', { status: 200 });
    }
  },
};

async function replyMessage(token, replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
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
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}
