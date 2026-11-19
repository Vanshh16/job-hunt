import Link from "next/link";
import { prisma } from "@/lib/db";
import { PIPELINE, STATUS_LABEL } from "@/lib/jobs";
import { ScoreBadge, fmtDate } from "@/components/ui";
import { StatusSelect } from "@/components/JobActions";

export const dynamic = "force-dynamic";

export default async function TrackerPage() {
  const jobs = await prisma.job.findMany({ where: { status: { in: PIPELINE } }, orderBy: { updatedAt: "desc" }, take: 500 });
  const now = Date.now();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Application tracker</h1>
        <p className="muted">Change a card&apos;s status from its dropdown. Applications with no reply for 30 days are auto-marked ghosted.</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {PIPELINE.map((s) => {
          const col = jobs.filter((j) => j.status === s);
          return (
            <div key={s} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-gray-700">
                {STATUS_LABEL[s]} <span className="rounded-full bg-gray-200 px-2 text-xs">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map((j) => {
                  const due = j.followUpAt && j.followUpAt.getTime() <= now;
                  return (
                    <div key={j.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/jobs/${j.id}`} className="text-sm leading-snug font-medium hover:text-brand-700">{j.title}</Link>
                        <ScoreBadge score={j.matchScore} />
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">{j.company}</div>
                      <div className="mt-1 text-xs text-gray-400">
                        {j.appliedAt ? `Applied ${fmtDate(j.appliedAt)}` : j.deadline ? `Due ${fmtDate(j.deadline)}` : ""}
                        {due && <span className="ml-1 font-medium text-amber-600">· follow up!</span>}
                      </div>
                      <div className="mt-2"><StatusSelect id={j.id} status={j.status} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
