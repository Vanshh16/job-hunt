// One-time interactive login. Prints a session string to store as TELEGRAM_SESSION.
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const rl = readline.createInterface({ input, output });
if (!process.env.TELEGRAM_API_ID) process.env.TELEGRAM_API_ID = await rl.question("API ID (from my.telegram.org): ");
if (!process.env.TELEGRAM_API_HASH) process.env.TELEGRAM_API_HASH = await rl.question("API hash: ");

const { makeClient } = await import("./common.mjs");
const client = makeClient("");
await client.start({
  phoneNumber: () => rl.question("Phone number (with country code, e.g. +91...): "),
  phoneCode: () => rl.question("Login code Telegram sent you: "),
  password: () => rl.question("2FA password (if enabled): "),
  onError: (e) => console.error(e.message),
});
const session = client.session.save();
console.log("\n✅ Logged in. Put this in TELEGRAM_SESSION (keep it secret — it grants access to your account):\n");
console.log(session);
rl.close();
await client.disconnect();
process.exit(0);
