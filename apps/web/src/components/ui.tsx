import type { JobStatus } from "@prisma/client";
import { STATUS_LABEL } from "@/lib/jobs";

const STATUS_COLOR: Record<JobStatus, string> = {
  NEW: "bg-sky-50 text-sky-700 ring-sky-200",
  SAVED: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  APPLIED: "bg-blue-50 text-blue-700 ring-blue-200",
  OA: "bg-amber-50 text-amber-800 ring-amber-200",
  INTERVIEW: "bg-violet-50 text-violet-700 ring-violet-200",
  OFFER: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
  GHOSTED: "bg-gray-100 text-gray-600 ring-gray-200",
  DISMISSED: "bg-gray-50 text-gray-400 ring-gray-200",
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">—</span>;
  const c = score >= 75 ? "bg-emerald-600" : score >= 55 ? "bg-amber-500" : "bg-gray-400";
  return <span className={`inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold text-white ${c}`}>{score}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card p-4!">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">{children}</div>;
}

export function timeAgo(d: Date) {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString();
}

export const fmtDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
