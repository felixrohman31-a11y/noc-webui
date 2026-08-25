/**
 * Dispatcher notifikasi: Webhook umum + Telegram Bot API.
 */
const store = require('./store');

async function postJson(url, body) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 6000);
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
  } finally { clearTimeout(t); }
}

async function dispatch(payload) {
  const s = store.getDb().settings;
  const jobs = [];
  if (s.webhookUrl) jobs.push(postJson(s.webhookUrl, { source: 'noc-webui', ...payload }).catch(e => console.error('[webhook]', e.message)));
  if (s.telegramBotToken && s.telegramChatId) {
    const d = payload.device || {};
    const txt = `🛰 NOC: [${payload.event}]\nDevice: ${d.name || '?'} (${d.host || '-'})` +
      (payload.latencyMs ? `\nLatency: ${payload.latencyMs} ms` : '') +
      `\nWaktu: ${new Date(payload.ts || Date.now()).toLocaleString('id-ID')}`;
    jobs.push(postJson(`https://api.telegram.org/bot${s.telegramBotToken}/sendMessage`, { chat_id: s.telegramChatId, text: txt }).catch(e => console.error('[telegram]', e.message)));
  }
  await Promise.allSettled(jobs);
}

async function testTelegram() {
  const s = store.getDb().settings;
  if (!s.telegramBotToken || !s.telegramChatId) return { ok: false, error: 'Telegram belum dikonfigurasi (token & chat id wajib)' };
  try {
    await postJson(`https://api.telegram.org/bot${s.telegramBotToken}/sendMessage`, {
      chat_id: s.telegramChatId,
      text: '✅ Test notifikasi dari NOC WebUI — berhasil tersambung.'
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { dispatch, testTelegram };
