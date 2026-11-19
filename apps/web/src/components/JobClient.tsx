"use client";

import { useState, useTransition } from "react";
import { deleteJob, generateForJob, rescoreJob, updateJob } from "@/app/actions";

const KINDS = [
  { k: "cover", label: "Cover letter" },
  { k: "referral", label: "Referral ask (LinkedIn)" },
  { k: "recruiter", label: "Cold email to recruiter" },
  { k: "followup", label: "Follow-up email" },
  { k: "thankyou", label: "Post-interview thank-you" },
] as const;

export function AiWriter({ jobId, initialCover }: { jobId: string; initialCover: string | null }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["k"]>("cover");
  const [extra, setExtra] = useState("");
  const [text, setText] = useState(initialCover ?? "");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">✍️ AI writer</h2>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((x) => (
          <button key={x.k} onClick={() => setKind(x.k)} className={`rounded-full px-3 py-1 text-xs ${kind === x.k ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
            {x.label}
          </button>
        ))}
      </div>
      <input className="input" placeholder="Optional instructions (e.g. mention my hackathon win, keep it short)" value={extra} onChange={(e) => setExtra(e.target.value)} />
      <button
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr("");
            try {
              setText(await generateForJob(jobId, kind, extra));
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Failed");
            }
          })
        }
      >
        {pending ? "Writing…" : "Generate"}
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {text && (
        <div className="relative">
          <textarea className="input min-h-64 font-[inherit] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} />
          <button
            className="btn-secondary absolute top-2 right-2 px-2! py-1! text-xs!"
            onClick={() => {
              navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

export function JobEditor(props: { id: string; notes: string | null; followUpAt: string | null; deadline: string | null; url: string | null }) {
  const [notes, setNotes] = useState(props.notes ?? "");
  const [followUpAt, setFollow] = useState(props.followUpAt ?? "");
  const [deadline, setDeadline] = useState(props.deadline ?? "");
  const [url, setUrl] = useState(props.url ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Notes & dates</h2>
      <div>
        <label className="label">Apply link</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Follow up on</label>
          <input type="date" className="input" value={followUpAt} onChange={(e) => setFollow(e.target.value)} />
        </div>
        <div>
          <label className="label">Deadline</label>
          <input type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label">Notes (referrer, recruiter, interview rounds…)</label>
        <textarea className="input min-h-28" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await updateJob(props.id, { notes, followUpAt: followUpAt || null, deadline: deadline || null, url });
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          })
        }
      >
        {saved ? "Saved ✓" : pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export function RescoreButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="btn-secondary" disabled={pending} onClick={() => start(() => rescoreJob(id))}>
      {pending ? "Analyzing…" : "↻ Re-analyze"}
    </button>
  );
}

export function DeleteJobButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="btn-danger" disabled={pending} onClick={() => confirm("Delete this job permanently?") && start(() => deleteJob(id))}>
      Delete
    </button>
  );
}
