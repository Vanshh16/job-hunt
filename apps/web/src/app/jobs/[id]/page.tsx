import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import type { MatchResult } from "@/lib/ai";
import { ScoreBadge, StatusBadge, fmtDate, timeAgo } from "@/components/ui";
import { StatusSelect } from "@/components/JobActions";
import { AiWriter, DeleteJobButton, JobEditor, RescoreButton } from "@/components/JobClient";

export const dynamic = "force-dynamic";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, include: { activities: { orderBy: { createdAt: "desc" } } } });
  if (!job) notFound();
  const resumes = await prisma.resume.findMany({ select: { id: true, label: true } });
  const rname = (rid: string | null) => resumes.find((r) => r.id === rid)?.label ?? "—";
  const a = job.analysis as MatchResult | null;

  return (
    <div className="space-y-5">
      <Link href="/jobs" className="text-sm text-gray-500 hover:text-gray-800">← Jobs</Link>

      <div className="card flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusBadge status={job.status} />
            <span className="text-xs text-gray-400">via {job.source} · {timeAgo(job.createdAt)}</span>
          </div>
          <h1 className="h1 mt-1">{job.title}</h1>
          <div className="text-gray-600">{job.company}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
            {job.location && <span>📍 {job.location}</span>}
            {job.experience && <span>🧑‍💻 {job.experience}</span>}
            {job.salary && <span>💰 {job.salary}</span>}
            {job.eligibility && <span>🎓 {job.eligibility}</span>}
            {job.deadline && <span className="text-rose-600">⏰ {fmtDate(job.deadline)}</span>}
            {job.appliedAt && <span>✅ Applied {fmtDate(job.appliedAt)}</span>}
            {job.applyEmail && <a className="text-brand-600" href={`mailto:${job.applyEmail}`}>✉️ {job.applyEmail}</a>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {job.url && <a href={job.url} target="_blank" rel="noreferrer" className="btn-primary">Apply ↗</a>}
          <StatusSelect id={job.id} status={job.status} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">Fit analysis <ScoreBadge score={job.matchScore} /></h2>
              <RescoreButton id={job.id} />
            </div>
            {a ? (
              <>
                <p className="text-sm text-gray-700">{a.summary}</p>
                <div className="rounded-lg bg-brand-50 p-3 text-sm">
                  <div className="font-medium text-brand-700">📄 Best resume: {rname(a.bestResumeId)}</div>
                  {a.resumeAdvice && <div className="mt-1 text-gray-700">{a.resumeAdvice}</div>}
                </div>
                {a.resumeFit?.length > 1 && (
                  <div className="space-y-1 text-sm">
                    {a.resumeFit.map((r) => (
                      <div key={r.resumeId} className="flex gap-2">
                        <ScoreBadge score={r.score} />
                        <span className="font-medium">{rname(r.resumeId)}</span>
                        <span className="text-gray-500">— {r.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="label">Matched skills</div>
                    <div className="flex flex-wrap gap-1">{a.matchedSkills?.map((s) => <span key={s} className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">{s}</span>)}</div>
                  </div>
                  <div>
                    <div className="label">Missing / weak</div>
                    <div className="flex flex-wrap gap-1">{a.missingSkills?.map((s) => <span key={s} className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">{s}</span>)}</div>
                  </div>
                </div>
                {a.redFlags?.length > 0 && <div className="text-sm text-amber-700">⚠️ {a.redFlags.join(" · ")}</div>}
              </>
            ) : (
              <p className="muted">Not analyzed yet. Upload resumes, then click Re-analyze.</p>
            )}
          </section>

          <section className="card">
            <h2 className="mb-2 font-semibold">Description</h2>
            <div className="prose-pre">{job.description || "No description captured."}</div>
            {job.rawText && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-gray-500">Original post</summary>
                <div className="prose-pre mt-2 max-h-96 overflow-auto rounded-lg bg-gray-50 p-3 text-xs!">{job.rawText}</div>
              </details>
            )}
          </section>

          <AiWriter jobId={job.id} initialCover={job.coverLetter} />
        </div>

        <div className="space-y-5 lg:col-span-2">
          <JobEditor id={job.id} notes={job.notes} followUpAt={iso(job.followUpAt)} deadline={iso(job.deadline)} url={job.url} />
          <section className="card">
            <h2 className="mb-2 font-semibold">Timeline</h2>
            <ul className="space-y-1.5 text-sm">
              {job.activities.map((x) => (
                <li key={x.id} className="flex gap-3">
                  <span className="w-16 shrink-0 text-xs text-gray-400">{timeAgo(x.createdAt)}</span>
                  <span className="text-gray-600">{x.message}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="flex justify-end">
            <DeleteJobButton id={job.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
