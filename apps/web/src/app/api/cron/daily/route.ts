import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { safeEqual } from "@/lib/auth";
import { escapeHtml, notify } from "@/lib/telegram";

/** Daily digest: follow-ups due, deadlines approaching, auto-ghosting, top unreviewed matches. */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const ok =
    (process.env.CRON_SECRET && safeEqual(auth, `Bearer ${process.env.CRON_SECRET}`)) ||
    (process.env.API_TOKEN && safeEqual(auth, `Bearer ${process.env.API_TOKEN}`));
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const in3days = new Date(now.getTime() + 3 * 86400000);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  // Applications with no response for 30 days -> ghosted.
  const ghosted = await prisma.job.updateMany({ where: { status: "APPLIED", appliedAt: { lt: monthAgo } }, data: { status: "GHOSTED", followUpAt: null } });

  const [followUps, deadlines, topNew, appliedWeek] = await Promise.all([
    prisma.job.findMany({ where: { followUpAt: { lte: now }, status: { in: ["APPLIED", "OA", "INTERVIEW"] } }, orderBy: { followUpAt: "asc" }, take: 10 }),
    prisma.job.findMany({ where: { deadline: { gte: now, lte: in3days }, status: { in: ["NEW", "SAVED"] } }, orderBy: { deadline: "asc" }, take: 10 }),
    prisma.job.findMany({ where: { status: "NEW", createdAt: { gte: new Date(now.getTime() - 86400000) } }, orderBy: { matchScore: "desc" }, take: 5 }),
    prisma.job.count({ where: { appliedAt: { gte: new Date(now.getTime() - 7 * 86400000) } } }),
  ]);

  const app = process.env.APP_URL || "";
  const link = (id: string, text: string) => (app.startsWith("http") ? `<a href="${app}/jobs/${id}">${escapeHtml(text)}</a>` : escapeHtml(text));
  const parts: string[] = [`<b>☀️ Job hunt daily digest</b>`, `Applied in the last 7 days: <b>${appliedWeek}</b>`];
  if (topNew.length) parts.push("", "<b>🔥 Best new matches (24h)</b>", ...topNew.map((j) => `• ${link(j.id, `${j.title} @ ${j.company}`)} — ${j.matchScore ?? "?"}/100`));
  if (deadlines.length) parts.push("", "<b>⏰ Deadlines in the next 3 days</b>", ...deadlines.map((j) => `• ${link(j.id, `${j.title} @ ${j.company}`)} — ${j.deadline!.toDateString()}`));
  if (followUps.length) parts.push("", "<b>📬 Follow-ups due</b>", ...followUps.map((j) => `• ${link(j.id, `${j.title} @ ${j.company}`)} (applied ${j.appliedAt?.toDateString() ?? "?"})`));
  if (ghosted.count) parts.push("", `👻 Marked ${ghosted.count} stale application(s) as ghosted.`);

  const sent = topNew.length || deadlines.length || followUps.length ? await notify(parts.join("\n")) : false;
  return NextResponse.json({ sent, followUps: followUps.length, deadlines: deadlines.length, topNew: topNew.length, ghosted: ghosted.count });
}
