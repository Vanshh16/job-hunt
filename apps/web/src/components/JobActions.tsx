"use client";

import { useTransition } from "react";
import type { JobStatus } from "@prisma/client";
import { updateJobStatus } from "@/app/actions";

const LABELS: Record<string, string> = {
  NEW: "New", SAVED: "Saved", APPLIED: "Applied", OA: "Assessment", INTERVIEW: "Interview",
  OFFER: "Offer", REJECTED: "Rejected", GHOSTED: "Ghosted", DISMISSED: "Dismissed",
};

export function QuickActions({ id, status, url }: { id: string; status: JobStatus; url: string | null }) {
  const [pending, start] = useTransition();
  const set = (s: JobStatus) => start(() => updateJobStatus(id, s));
  return (
    <div className={`flex shrink-0 flex-wrap items-center gap-1.5 ${pending ? "opacity-50" : ""}`}>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="btn-secondary px-2.5! py-1! text-xs!">Open ↗</a>
      )}
      {status === "NEW" && <button onClick={() => set("SAVED")} className="btn-secondary px-2.5! py-1! text-xs!">Save</button>}
      {(status === "NEW" || status === "SAVED") && (
        <>
          <button onClick={() => set("APPLIED")} className="btn-primary px-2.5! py-1! text-xs!">Applied ✓</button>
          <button onClick={() => set("DISMISSED")} className="btn-ghost px-2! py-1! text-xs!" title="Not interested">✕</button>
        </>
      )}
    </div>
  );
}

export function StatusSelect({ id, status }: { id: string; status: JobStatus }) {
  const [pending, start] = useTransition();
  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) => start(() => updateJobStatus(id, e.target.value as JobStatus))}
      className="input w-auto! py-1! text-xs!"
    >
      {Object.keys(LABELS).map((s) => (
        <option key={s} value={s}>{LABELS[s]}</option>
      ))}
    </select>
  );
}
