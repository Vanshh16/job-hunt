// Pulls new messages from your selected Telegram groups and sends them to the dashboard.
// Which groups: picked on the dashboard's Setup page. Each run uploads your group/channel list there.
// TELEGRAM_GROUPS (optional) is only used as the initial selection before you've picked any in the dashboard.
//   node src/sync.mjs          -> one pass (for cron / GitHub Actions)
//   node src/sync.mjs --watch  -> one pass, then stay connected and forward new messages live
import { NewMessage } from "telegram/events/index.js";
import { makeClient, need } from "./common.mjs";

const APP_URL = need("APP_URL").replace(/\/+$/, "");
const API_TOKEN = need("API_TOKEN");
need("TELEGRAM_SESSION");
const ENV_GROUPS = (process.env.TELEGRAM_GROUPS || "").split(",").map((s) => s.trim()).filter(Boolean);
const BACKFILL = Number(process.env.INITIAL_BACKFILL || 30);
const WATCH = process.argv.includes("--watch");

// A one-shot sync should finish in a minute or two. If Telegram becomes unreachable, GramJS can retry
// for a long time — fail loudly instead (the next scheduled run resumes from the saved cursor).
if (!WATCH) {
  setTimeout(() => {
    console.error("\n✖ Sync took longer than 7 minutes (Telegram unreachable or AI very slow). Exiting; the next run will resume where this one stopped.");
    process.exit(1);
  }, 7 * 60_000).unref();
}

async function api(path, body, attempt = 1) {
  const res = await fetch(APP_URL + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${API_TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  // `next dev` compiles routes on first hit and can briefly answer 404/5xx; Vercel can cold-start. Retry a few times.
  if ((res.status === 404 || res.status >= 502) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return api(path, body, attempt + 1);
  }
  if (res.status === 401) {
    console.error(`\n✖ The dashboard at ${APP_URL} rejected API_TOKEN (401).\n  API_TOKEN in apps/worker/.env must exactly match API_TOKEN in the dashboard's env (apps/web/.env locally, or Vercel's env vars), and the dashboard must be restarted/redeployed after changing it.`);
    process.exit(1);
  }
  if (!res.ok) {
    const text = await res.text();
    // Gemini free tier said "slow down" (429) or is briefly overloaded (503): wait and retry.
    if (/\b(429|503)\b|quota|rate.?limit|overloaded|unavailable/i.test(text) && attempt < 4) {
      console.log(`  …AI busy/rate-limited, waiting 60s (attempt ${attempt}/3)`);
      await new Promise((r) => setTimeout(r, 60_000));
      return api(path, body, attempt + 1);
    }
    throw new Error(`${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Message text plus any hidden links (text links, URL buttons) so apply links aren't lost. */
function fullText(msg) {
  let text = msg.message || "";
  const urls = new Set();
  for (const e of msg.entities || []) if (e.url) urls.add(e.url);
  for (const row of msg.replyMarkup?.rows || []) for (const b of row.buttons || []) if (b.url) urls.add(b.url);
  const extra = [...urls].filter((u) => !text.includes(u));
  if (extra.length) text += "\n\nLinks:\n" + extra.join("\n");
  return text;
}

function messageLink(entity, id) {
  if (entity.username) return `https://t.me/${entity.username}/${id}`;
  return `https://t.me/c/${String(entity.id).replace(/^-100/, "")}/${id}`;
}

async function ingest(chatKey, entity, msg) {
  const text = fullText(msg);
  const r = await api("/api/ingest/telegram", { chat: chatKey, messageId: msg.id, text, link: messageLink(entity, msg.id) });
  if (r.jobsFound) console.log(`  #${msg.id}: ${r.jobsFound} job(s), ${r.created} new`);
}

/** Does a TELEGRAM_GROUPS entry (numeric id, @username or t.me link) refer to this chat? */
function matchesEnv(g, chat) {
  if (/^-?\d+$/.test(g)) return g === chat.markedId || g.replace(/^-100/, "").replace(/^-/, "") === chat.id;
  const u = g.replace(/^https?:\/\/t\.me\//, "").replace(/^@/, "").toLowerCase();
  return !!chat.username && chat.username.toLowerCase() === u;
}

const client = makeClient();
await client.connect();

// 1. Upload the list of groups/channels this account is in, get back the ones selected in the dashboard.
const dialogs = await client.getDialogs({ limit: 500 });
const chats = dialogs
  .filter((d) => (d.isGroup || d.isChannel) && d.entity)
  .map((d) => ({
    id: String(d.entity.id),
    markedId: String(d.id),
    title: d.title || "(untitled)",
    username: d.entity.username || null,
    kind: d.isChannel && !d.isGroup ? "channel" : "group",
    entity: d.entity,
  }));
const envGroups = chats.filter((c) => ENV_GROUPS.some((g) => matchesEnv(g, c))).map((c) => c.id);
const { groups, managed } = await api("/api/ingest/chats", {
  chats: chats.map(({ id, title, username, kind }) => ({ id, title, username, kind })),
  envGroups,
});
const selected = chats.filter((c) => groups.includes(c.id));
console.log(`Uploaded ${chats.length} groups/channels. Syncing ${selected.length} selected in the dashboard.`);
if (!selected.length) {
  console.log(
    managed
      ? "No groups are ticked on the dashboard's Setup page — nothing to sync."
      : "No groups selected yet: tick the groups to read on the dashboard's Setup page (or set TELEGRAM_GROUPS).",
  );
}

// 2. Pull new messages from each selected group.
const entities = [];
for (const c of selected) {
  const { entity, id: chatKey } = c;
  const g = c.title;
  entities.push({ entity, chatKey });
  const { lastMessageId } = await api(`/api/ingest/cursor?chat=${encodeURIComponent(chatKey)}`);
  const msgs = lastMessageId
    ? await client.getMessages(entity, { minId: lastMessageId, limit: 200, reverse: true })
    : (await client.getMessages(entity, { limit: BACKFILL })).reverse();
  console.log(`${entity.title || g}: ${msgs.length} new message(s) since #${lastMessageId}`);
  for (const m of msgs) {
    if (!m.message && !m.replyMarkup) continue;
    try {
      await ingest(chatKey, entity, m);
    } catch (e) {
      console.error(`  #${m.id} failed: ${e.message}`);
      break; // keep cursor here; retry next run
    }
  }
}

if (WATCH) {
  console.log("Watching for new messages… (Ctrl+C to stop)");
  client.addEventHandler(
    async (event) => {
      const m = event.message;
      const hit = entities.find((x) => String(m.chatId) === x.chatKey || String(m.chatId) === `-100${x.chatKey}`);
      if (hit) await ingest(hit.chatKey, hit.entity, m).catch((e) => console.error(e.message));
    },
    new NewMessage({ chats: entities.map((x) => x.entity) }),
  );
} else {
  await client.disconnect();
  process.exit(0);
}
