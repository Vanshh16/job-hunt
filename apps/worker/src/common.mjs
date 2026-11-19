import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

export function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

export function makeClient(session = process.env.TELEGRAM_SESSION || "") {
  const client = new TelegramClient(new StringSession(session), Number(need("TELEGRAM_API_ID")), need("TELEGRAM_API_HASH"), {
    connectionRetries: 5,
  });
  client.setLogLevel("error");
  return client;
}
