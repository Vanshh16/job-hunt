// Pulls new messages from the configured Telegram groups and sends them to the dashboard.
//   node src/sync.mjs          -> one pass (for cron / GitHub Actions)
//   node src/sync.mjs --watch  -> one pass, then stay connected and forward new messages live
import { NewMessage } from "telegram/events/index.js";
import { makeClient, need } from "./common.mjs";

const APP_URL = need("APP_URL").replace(/\/+$/, "");
const API_TOKEN = need("API_TOKEN");
need("TELEGRAM_SESSION");
const GROUPS = need("TELEGRAM_GROUPS").split(",").map((s) => s.trim()).filter(Boolean);
const BACKFILL = Number(process.env.INITIAL_BACKFILL || 30);
const WATCH = process.argv.includes("--watch");

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

async function resolve(client, g) {
  if (!/^-?\d+$/.test(g)) return client.getEntity(g.replace(/^https?:\/\/t\.me\//, "").replace(/^@?/, "@"));
  // Numeric ids (from `npm run chats`) are resolved via the dialog list.
  const dialogs = await client.getDialogs({ limit: 300 });
  const d = dialogs.find((x) => String(x.id) === g || String(x.entity?.id) === g.replace(/^-100/, ""));
  if (!d) throw new Error(`Can't find group "${g}". Run \`npm run chats\` to list ids.`);
  return d.entity;
}

const client = makeClient();
await client.connect();
const entities = [];
for (const g of GROUPS) {
  const entity = await resolve(client, g);
  const chatKey = String(entity.id);
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
