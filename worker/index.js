// Cloudflare Worker: LINE Webhook → GitHub Actions trigger
// Receives LINE messages, triggers GitHub Actions workflow on keyword match

const TRIGGER_KEYWORDS = ['更新', '刷新', 'update', 'refresh'];
const GITHUB_REPO = 'suchen72/library-monitor';
const WORKFLOW_FILE = 'scrape.yml';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      // Verify LINE webhook signature
      const body = await request.text();
      const signature = request.headers.get('x-line-signature');
      if (!await verifySignature(env.LINE_CHANNEL_SECRET, body, signature)) {
        return new Response('Invalid signature', { status: 403 });
      }

      const data = JSON.parse(body);
      for (const event of (data.events || [])) {
        if (event.type === 'message' && event.message?.type === 'text') {
          const text = event.message.text.trim().toLowerCase();
          const isTriggered = TRIGGER_KEYWORDS.some(kw => text.includes(kw));

          if (isTriggered) {
            // Trigger GitHub Actions
            const ghRes = await fetch(
              `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${env.GITHUB_PAT}`,
                  'Accept': 'application/vnd.github.v3+json',
                  'User-Agent': 'library-monitor-line-bot',
                },
                body: JSON.stringify({ ref: 'main' }),
              }
            );

            // Reply to user
            const replyText = ghRes.ok
              ? '已觸發更新，完成後會通知你 📚'
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
