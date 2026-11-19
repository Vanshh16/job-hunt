const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Sends an HTML-formatted message to the owner. Silently no-ops when not configured. */
export async function notify(html: string, buttons?: { text: string; url: string }[][]) {
  if (!telegramConfigured()) return false;
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: html.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
    }),
  });
  if (!res.ok) console.error("Telegram notify failed", res.status, await res.text());
  return res.ok;
}

/** Returns chats that recently messaged the bot, so the user can find their chat id. */
export async function detectChats() {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(api("getUpdates"));
  const data = (await res.json()) as { ok: boolean; result?: { message?: { chat: { id: number; first_name?: string; title?: string; username?: string } } }[] };
  const chats = new Map<number, string>();
  for (const u of data.result ?? []) {
    const c = u.message?.chat;
    if (c) chats.set(c.id, c.title || c.first_name || c.username || String(c.id));
  }
  return [...chats.entries()].map(([id, name]) => ({ id, name }));
}
