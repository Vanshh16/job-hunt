import Link from "next/link";
import { prisma } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/jobs";
import { Empty, ScoreBadge, Stat, StatusBadge, fmtDate, timeAgo } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const [byStatus, appliedWeek, topNew, followUps, deadlines, activity, resumeCount, profile] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], _count: true }),
    prisma.job.count({ where: { appliedAt: { gte: weekAgo } } }),
    prisma.job.findMany({ where: { status: "NEW" }, orderBy: [{ matchScore: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take: 8 }),
    prisma.job.findMany({ where: { followUpAt: { lte: now }, status: { in: ["APPLIED", "OA", "INTERVIEW"] } }, orderBy: { followUpAt: "asc" }, take: 6 }),
    prisma.job.findMany({ where: { deadline: { gte: new Date(now.getTime() - 86400000) }, status: { in: ["NEW", "SAVED"] } }, orderBy: { deadline: "asc" }, take: 6 }),
    prisma.activity.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { job: { select: { id: true, title: true, company: true } } } }),
    prisma.resume.count(),
    prisma.profile.findUnique({ where: { id: 1 } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const applied = ["APPLIED", "OA", "INTERVIEW", "OFFER", "REJECTED", "GHOSTED"].reduce((a, s) => a + count(s), 0);
  const responded = ["OA", "INTERVIEW", "OFFER", "REJECTED"].reduce((a, s) => a + count(s), 0);
  const profileEmpty = !profile || Object.keys((profile.fields as object) ?? {}).length < 3;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Dashboard</h1>
          <p className="muted">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <Link href="/jobs" className="btn-primary">Review new jobs ({count("NEW")})</Link>
      </div>

      {(profileEmpty || resumeCount === 0) && (
        <div className="card border-amber-200 bg-amber-50">
          <div className="font-medium text-amber-900">Finish setup to unlock autofill and matching</div>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
            {profileEmpty && <li><Link className="underline" href="/profile">Fill in your profile</Link> — used to autofill every form.</li>}
            {resumeCount === 0 && <li><Link className="underline" href="/resumes">Upload your 2–3 resumes</Link> — the AI picks the best one per job.</li>}
            <li><Link className="underline" href="/settings">Install the Chrome extension and connect Telegram</Link>.</li>
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="New jobs" value={count("NEW")} hint="waiting for review" />
        <Stat label="Applied (7d)" value={appliedWeek} hint="goal: 5+/day" />
        <Stat label="Total applied" value={applied} />
        <Stat label="Response rate" value={applied ? `${Math.round((responded / applied) * 100)}%` : "—"} hint="OA, interview, offer, rejection" />
        <Stat label="Interviews" value={count("INTERVIEW") + count("OA")} hint={`${count("OFFER")} offer(s)`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Top new matches</h2>
            <Link href="/jobs?status=NEW" className="text-sm text-brand-600 hover:underline">All new →</Link>
          </div>
          {topNew.length ? (
            <ul className="divide-y divide-gray-100">
              {topNew.map((j) => (
                <li key={j.id} className="flex items-center gap-3 py-2.5">
                  <ScoreBadge score={j.matchScore} />
                  <Link href={`/jobs/${j.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium hover:text-brand-700">{j.title}</div>
                    <div className="truncate text-xs text-gray-500">{j.company}{j.location ? ` · ${j.location}` : ""} · {j.source} · {timeAgo(j.createdAt)}</div>
                  </Link>
                  {j.deadline && <span className="text-xs text-rose-600">due {fmtDate(j.deadline)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No new jobs yet. Connect the Telegram group, or <Link className="text-brand-600 underline" href="/import">paste a post</Link>.</Empty>
          )}
        </section>

        <div className="space-y-6">
          <section className="card">
            <h2 className="mb-2 font-semibold">⏰ Upcoming deadlines</h2>
            {deadlines.length ? (
              <ul className="space-y-2 text-sm">
                {deadlines.map((j) => (
                  <li key={j.id} className="flex justify-between gap-2">
                    <Link className="truncate hover:text-brand-700" href={`/jobs/${j.id}`}>{j.title} · {j.company}</Link>
                    <span className="shrink-0 text-xs text-rose-600">{fmtDate(j.deadline)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Nothing due.</p>}
          </section>
          <section className="card">
            <h2 className="mb-2 font-semibold">📬 Follow-ups due</h2>
            {followUps.length ? (
              <ul className="space-y-2 text-sm">
                {followUps.map((j) => (
                  <li key={j.id} className="flex justify-between gap-2">
                    <Link className="truncate hover:text-brand-700" href={`/jobs/${j.id}`}>{j.title} · {j.company}</Link>
                    <StatusBadge status={j.status} />
                  </li>
                ))}
              </ul>
            ) : <p className="muted">You&apos;re all caught up.</p>}
          </section>
        </div>
      </div>

      <section className="card">
        <h2 className="mb-2 font-semibold">Recent activity</h2>
        {activity.length ? (
          <ul className="space-y-1.5 text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="w-20 shrink-0 text-xs text-gray-400">{timeAgo(a.createdAt)}</span>
                <span className="min-w-0 truncate">
                  {a.job ? <Link className="font-medium hover:text-brand-700" href={`/jobs/${a.job.id}`}>{a.job.title} · {a.job.company}</Link> : null}{" "}
                  <span className="text-gray-500">{a.message.replace(/Status → (\w+)/, (_, s) => `→ ${STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No activity yet.</p>}
      </section>
    </div>
  );
}
