const LINE_API_URL = 'https://api.line.me/v2/bot/message/push';
const MAX_TEXT_LENGTH = 5000;

function readLineConfig() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targetId = process.env.LINE_TARGET_ID;
  if (!token || !targetId) return null;
  return { token, targetId };
}

async function sendLineMessage(token, targetId, text) {
  // Split into chunks if text exceeds LINE's 5000 char limit
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX_TEXT_LENGTH) {
    chunks.push(text.substring(i, i + MAX_TEXT_LENGTH));
  }

  for (const chunk of chunks) {
    const res = await fetch(LINE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: targetId,
        messages: [{ type: 'text', text: chunk }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LINE API error ${res.status}: ${body}`);
    }
  }
}

module.exports = { readLineConfig, sendLineMessage };
