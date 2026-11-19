// Lists your groups/channels with ids, so you can set TELEGRAM_GROUPS.
import { makeClient, need } from "./common.mjs";

need("TELEGRAM_SESSION");
const client = makeClient();
await client.connect();
const dialogs = await client.getDialogs({ limit: 300 });
for (const d of dialogs) {
  if (!d.isGroup && !d.isChannel) continue;
  const username = d.entity?.username ? `@${d.entity.username}` : "";
  console.log(`${String(d.id).padEnd(16)} ${d.isChannel && !d.isGroup ? "channel" : "group  "}  ${d.title} ${username}`);
}
await client.disconnect();
process.exit(0);
