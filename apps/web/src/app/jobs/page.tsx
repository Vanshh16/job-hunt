import Link from "next/link";
import type { JobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { STATUSES, STATUS_LABEL } from "@/lib/jobs";
import { Empty, ScoreBadge, StatusBadge, fmtDate, timeAgo } from "@/components/ui";
import { QuickActions } from "@/components/JobActions";

export const dynamic = "force-dynamic";

type SP = Promise<{ status?: string; q?: string; min?: string; source?: string; sort?: string }>;

export default async function JobsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const status = (STATUSES.includes(sp.status as JobStatus) ? sp.status : sp.status === "ALL" ? "ALL" : "NEW") as JobStatus | "ALL";
  const min = Number(sp.min) || 0;
  const where: Prisma.JobWhereInput = {
    ...(status !== "ALL" ? { status } : { status: { not: "DISMISSED" } }),
    ...(min ? { matchScore: { gte: min } } : {}),
    ...(sp.source ? { source: sp.source } : {}),
    ...(sp.q
      ? { OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { company: { contains: sp.q, mode: "insensitive" } }, { description: { contains: sp.q, mode: "insensitive" } }] }
      : {}),
  };
  const orderBy: Prisma.JobOrderByWithRelationInput[] =
    sp.sort === "recent" ? [{ createdAt: "desc" }] : sp.sort === "deadline" ? [{ deadline: { sort: "asc", nulls: "last" } }] : [{ matchScore: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
  const [jobs, counts] = await Promise.all([
    prisma.job.findMany({ where, orderBy, take: 200 }),
    prisma.job.groupBy({ by: ["status"], _count: true }),
  ]);
  const c = (s: string) => counts.find((x) => x.status === s)?._count ?? 0;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/jobs?${p}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Jobs</h1>
          <p className="muted">Everything discovered from Telegram, the extension and manual imports, ranked by fit.</p>
        </div>
        <Link href="/import" className="btn-secondary">＋ Import / add job</Link>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(["NEW", "SAVED", "APPLIED", "ALL", "DISMISSED"] as const).map((s) => (
          <Link key={s} href={qs({ status: s })} className={`rounded-full px-3 py-1 text-sm ${status === s ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>
            {s === "ALL" ? "All" : STATUS_LABEL[s]} {s !== "ALL" && <span className="opacity-70">{c(s)}</span>}
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap gap-2" action="/jobs">
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={sp.q} placeholder="Search title, company, skills…" className="input max-w-xs" />
        <select name="min" defaultValue={sp.min ?? ""} className="input w-auto!">
          <option value="">Any score</option>
          <option value="50">50+</option>
          <option value="65">65+</option>
          <option value="80">80+</option>
        </select>
        <select name="source" defaultValue={sp.source ?? ""} className="input w-auto!">
          <option value="">All sources</option>
          <option value="telegram">Telegram</option>
          <option value="extension">Extension</option>
          <option value="manual">Manual</option>
        </select>
        <select name="sort" defaultValue={sp.sort ?? ""} className="input w-auto!">
          <option value="">Best match</option>
          <option value="recent">Most recent</option>
          <option value="deadline">Deadline</option>
        </select>
        <button className="btn-secondary">Filter</button>
      </form>

      {jobs.length ? (
        <ul className="card divide-y divide-gray-100 p-0!">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <ScoreBadge score={j.matchScore} />
                <Link href={`/jobs/${j.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium hover:text-brand-700">{j.title}</span>
                    {status === "ALL" && <StatusBadge status={j.status} />}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {j.company}
                    {j.location ? ` · ${j.location}` : ""}
                    {j.experience ? ` · ${j.experience}` : ""}
                    {` · ${j.source} · ${timeAgo(j.createdAt)}`}
                    {j.deadline ? <span className="text-rose-600"> · due {fmtDate(j.deadline)}</span> : null}
                  </div>
                  {j.matchSummary && <div className="mt-0.5 line-clamp-1 text-xs text-gray-600">{j.matchSummary}</div>}
                </Link>
              </div>
              <QuickActions id={j.id} status={j.status} url={j.url} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No jobs here.</Empty>
      )}
    </div>
  );
}
