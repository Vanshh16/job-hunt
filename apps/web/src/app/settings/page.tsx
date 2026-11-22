import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { TelegramTools } from "@/components/Forms";
import { AI_MODEL } from "@/lib/ai";
import { TelegramGroups, type ChatRow } from "@/components/TelegramGroups";

export const dynamic = "force-dynamic";

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={ok ? "text-emerald-600" : "text-gray-300"}>{ok ? "✔" : "○"}</span>
      <span className={ok ? "" : "text-gray-500"}>{children}</span>
    </li>
  );
}

export default async function SettingsPage() {
  const h = await headers();
  const origin = process.env.APP_URL?.startsWith("http") ? process.env.APP_URL : `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const [lastTg, tgCount, resumes, profile, tgChats, tgStats] = await Promise.all([
    prisma.telegramMessage.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.telegramMessage.count(),
    prisma.resume.count(),
    prisma.profile.findUnique({ where: { id: 1 } }),
    prisma.telegramChat.findMany({ orderBy: { title: "asc" } }),
    prisma.telegramMessage.groupBy({ by: ["chat"], _count: true, _sum: { jobsFound: true } }),
  ]);
  const stat = new Map(tgStats.map((s) => [s.chat, s]));
  const chatRows: ChatRow[] = tgChats.map((c) => ({
    id: c.id,
    title: c.title,
    username: c.username,
    kind: c.kind,
    enabled: c.enabled,
    messages: stat.get(c.id)?._count ?? 0,
    jobs: stat.get(c.id)?._sum.jobsFound ?? 0,
    lastSync: null,
  }));
  const lastUpload = tgChats.reduce<Date | null>((m, c) => (!m || c.seenAt > m ? c.seenAt : m), null);
  const env = (k: string) => Boolean(process.env[k]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Setup</h1>
        <p className="muted">Connect the pieces. Full instructions are in the project README.</p>
      </div>

      <section className="card">
        <h2 className="mb-2 font-semibold">Status</h2>
        <ul className="space-y-1.5">
          <Check ok={env("GEMINI_API_KEY")}>Gemini API key configured (model: {AI_MODEL()})</Check>
          <Check ok={env("API_TOKEN")}>API token for the extension and worker</Check>
          <Check ok={Object.keys((profile?.fields as object) ?? {}).length >= 3}>Profile filled</Check>
          <Check ok={resumes > 0}>{resumes} resume(s) uploaded</Check>
          <Check ok={env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_CHAT_ID")}>Telegram notifications bot</Check>
          <Check ok={tgCount > 0}>
            Telegram group sync {lastTg ? `— last message ingested ${lastTg.createdAt.toLocaleString("en-IN")}, ${tgCount} total` : "— no messages ingested yet"}
          </Check>
          <Check ok={env("CRON_SECRET")}>Daily digest cron secret</Check>
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">1 · Chrome extension</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
          <li>Open <code className="rounded bg-gray-100 px-1">chrome://extensions</code>, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and pick the <code className="rounded bg-gray-100 px-1">apps/extension</code> folder.</li>
          <li>Pin it, click the icon, open <b>Settings</b> in the side panel, and enter:</li>
        </ol>
        <div className="grid gap-2 rounded-lg bg-gray-50 p-3 font-mono text-sm">
          <div>Dashboard URL: <b>{origin}</b></div>
          <details>
            <summary className="cursor-pointer font-sans text-gray-600">API token (click to reveal)</summary>
            <div className="mt-1 break-all">{process.env.API_TOKEN || "— set API_TOKEN env var —"}</div>
          </details>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">2 · Telegram notifications (your personal bot)</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
          <li>In Telegram, message <b>@BotFather</b> → <code>/newbot</code> → copy the token into <code>TELEGRAM_BOT_TOKEN</code>.</li>
          <li>Open your new bot and press <b>Start</b>.</li>
          <li>Click &ldquo;Detect my chat ID&rdquo;, put the number in <code>TELEGRAM_CHAT_ID</code>, redeploy, then send a test.</li>
        </ol>
        <TelegramTools />
      </section>

      <section id="telegram-groups" className="card space-y-3">
        <div>
          <h2 className="font-semibold">3 · Telegram groups to read</h2>
          <p className="text-sm text-gray-700">
            Tick the groups and channels the worker should scan for jobs. It reads them as you every 20 minutes (GitHub Actions), and new jobs are scored and pushed to your bot.
          </p>
        </div>
        <TelegramGroups chats={chatRows} lastUpload={lastUpload ? lastUpload.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : null} />
      </section>
    </div>
  );
}
