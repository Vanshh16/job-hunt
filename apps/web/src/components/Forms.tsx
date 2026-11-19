"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  addManualJob, deleteAnswer, deleteResume, findTelegramChats, importText, renameResume,
  rescoreOpenJobs, saveAnswer, savePreferences, saveProfile, setDefaultResume, testTelegram, uploadResume,
} from "@/app/actions";
import type { ProfileFieldDef, Preferences } from "@/lib/profile";
import { ScoreBadge } from "./ui";

function Saved({ state }: { state: { ok?: boolean; error?: string } | null }) {
  if (state?.error) return <span className="text-sm text-red-600">{state.error}</span>;
  if (state?.ok) return <span className="text-sm text-emerald-600">Saved ✓</span>;
  return null;
}

// ---------- Import ----------

export function ImportForm() {
  const [state, action, pending] = useActionState(importText, null);
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Paste a job post</h2>
      <p className="muted">Telegram/WhatsApp forwards, LinkedIn posts, emails — anything. Multiple jobs in one post are split automatically.</p>
      <textarea name="text" className="input min-h-56" placeholder="🚀 Company X is hiring Frontend Interns! Batch 2025/26. Apply: https://…" required />
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Extracting & scoring…" : "Extract jobs"}</button>
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
      {state?.results && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {state.results.length === 0 && <li className="p-3 text-sm text-gray-500">No job openings found in that text.</li>}
          {state.results.map((r) => (
            <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
              <ScoreBadge score={r.score} />
              <Link href={`/jobs/${r.id}`} className="flex-1 font-medium hover:text-brand-700">{r.title} · {r.company}</Link>
              <span className="text-xs text-gray-500">{r.created ? "added" : "already existed"}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

export function ManualJobForm() {
  const [state, action, pending] = useActionState(addManualJob, null);
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Add a job manually</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Title *</label><input name="title" className="input" required /></div>
        <div><label className="label">Company *</label><input name="company" className="input" required /></div>
        <div><label className="label">Apply link</label><input name="url" className="input" type="url" /></div>
        <div><label className="label">Location</label><input name="location" className="input" /></div>
      </div>
      <div><label className="label">Description (paste the JD for a fit score)</label><textarea name="description" className="input min-h-28" /></div>
      <div className="flex items-center gap-3">
        <button className="btn-secondary" disabled={pending}>{pending ? "Adding…" : "Add job"}</button>
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

// ---------- Resumes ----------

export function ResumeUpload() {
  const [state, action, pending] = useActionState(uploadResume, null);
  return (
    <form action={action} className="card space-y-3" key={state?.at}>
      <h2 className="font-semibold">Upload a resume</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Label</label><input name="label" className="input" placeholder="e.g. Frontend, Backend, Analytics" /></div>
        <div><label className="label">PDF file (text-based, max 4 MB)</label><input name="file" type="file" accept=".pdf,.txt" className="input py-1.5!" required /></div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Uploading…" : "Upload"}</button>
        <Saved state={state} />
      </div>
    </form>
  );
}

export function ResumeRow({ r }: { r: { id: string; label: string; fileName: string; isDefault: boolean; chars: number; createdAt: string } }) {
  const [label, setLabel] = useState(r.label);
  const [pending, start] = useTransition();
  return (
    <li className={`flex flex-wrap items-center gap-3 px-4 py-3 ${pending ? "opacity-50" : ""}`}>
      <input className="input max-w-52" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== r.label && start(() => renameResume(r.id, label))} />
      <a href={`/api/resumes/${r.id}/file`} target="_blank" className="text-sm text-brand-600 hover:underline">{r.fileName}</a>
      <span className="text-xs text-gray-400">{r.chars.toLocaleString()} chars extracted</span>
      <div className="ml-auto flex gap-2">
        {r.isDefault ? <span className="rounded-full bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">Default</span> : <button className="btn-ghost text-xs!" onClick={() => start(() => setDefaultResume(r.id))}>Make default</button>}
        <button className="btn-danger px-2! py-1! text-xs!" onClick={() => confirm("Delete this resume?") && start(() => deleteResume(r.id))}>Delete</button>
      </div>
    </li>
  );
}

export function RescoreAll() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <div className="flex items-center gap-3">
      <button className="btn-secondary" disabled={pending} onClick={() => start(async () => setMsg(`Re-scored ${(await rescoreOpenJobs()).rescored} jobs`))}>
        {pending ? "Re-scoring…" : "Re-score open jobs with current resumes"}
      </button>
      {msg && <span className="text-sm text-gray-500">{msg}</span>}
    </div>
  );
}

// ---------- Profile ----------

export function ProfileForm({ defs, values }: { defs: ProfileFieldDef[]; values: Record<string, string> }) {
  const [state, action, pending] = useActionState(saveProfile, null);
  const known = new Set(defs.map((d) => d.key));
  const [extras, setExtras] = useState(Object.entries(values).filter(([k]) => !known.has(k)));
  const groups = [...new Set(defs.map((d) => d.group))];
  return (
    <form action={action} className="space-y-5">
      {groups.map((g) => (
        <section key={g} className="card">
          <h2 className="mb-3 font-semibold">{g}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {defs.filter((d) => d.group === g).map((d) => (
              <div key={d.key} className={d.type === "textarea" ? "sm:col-span-2" : ""}>
                <label className="label" htmlFor={d.key}>{d.label}</label>
                {d.type === "textarea" ? (
                  <textarea id={d.key} name={d.key} defaultValue={values[d.key] ?? ""} placeholder={d.placeholder} className="input min-h-20" />
                ) : (
                  <input id={d.key} name={d.key} type={d.type === "date" ? "date" : "text"} defaultValue={values[d.key] ?? ""} placeholder={d.placeholder} className="input" />
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      <section className="card">
        <h2 className="font-semibold">Custom fields</h2>
        <p className="muted mb-3">Anything else forms keep asking (e.g. &quot;Aadhaar last 4&quot;, &quot;Hackerrank ID&quot;, &quot;Father&apos;s name&quot;). The AI uses these too.</p>
        <div className="space-y-2">
          {extras.map(([k, v], i) => (
            <div key={i} className="flex gap-2">
              <input name="extra_key" defaultValue={k} placeholder="Field name" className="input max-w-60" />
              <input name="extra_value" defaultValue={v} placeholder="Value" className="input" />
              <button type="button" className="btn-ghost" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn-ghost text-brand-600!" onClick={() => setExtras([...extras, ["", ""]])}>＋ Add field</button>
        </div>
      </section>
      <div className="sticky bottom-4 flex items-center gap-3">
        <button className="btn-primary shadow-lg" disabled={pending}>{pending ? "Saving…" : "Save profile"}</button>
        <Saved state={state} />
      </div>
    </form>
  );
}

export function PreferencesForm({ prefs }: { prefs: Preferences }) {
  const [state, action, pending] = useActionState(savePreferences, null);
  const f = (name: keyof Preferences, label: string, hint?: string) => (
    <div>
      <label className="label">{label}</label>
      <input name={name} defaultValue={String(prefs[name])} className="input" />
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Job preferences (used for match scoring)</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {f("targetRoles", "Target roles")}
        {f("locations", "Locations")}
        {f("experienceLevel", "Your experience level")}
        {f("mustHaveKeywords", "Nice-to-have keywords", "Boost jobs mentioning these")}
        {f("excludeKeywords", "Exclude keywords", "Penalize jobs mentioning these")}
        <div className="grid grid-cols-2 gap-3">
          {f("minScoreToNotify", "Notify me at score ≥")}
          {f("followUpDays", "Follow up after (days)")}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save preferences"}</button>
        <Saved state={state} />
      </div>
    </form>
  );
}

// ---------- Answers ----------

export function AnswerForm({ a }: { a?: { id: string; question: string; answer: string; uses: number } }) {
  const [state, action, pending] = useActionState(saveAnswer, null);
  const [del, startDel] = useTransition();
  return (
    <form action={action} key={a ? a.id : state?.at} className={`card space-y-2 ${del ? "opacity-50" : ""}`}>
      <input type="hidden" name="id" value={a?.id ?? ""} />
      <input name="question" defaultValue={a?.question} placeholder="Question (e.g. Why do you want to work here?)" className="input font-medium" required />
      <textarea name="answer" defaultValue={a?.answer} placeholder="Your answer" className="input min-h-20" required />
      <div className="flex items-center gap-3">
        <button className="btn-secondary px-3! py-1.5! text-xs!" disabled={pending}>{pending ? "Saving…" : a ? "Update" : "Add answer"}</button>
        {a && <span className="text-xs text-gray-400">used {a.uses}×</span>}
        <Saved state={state} />
        {a && <button type="button" className="ml-auto text-xs text-red-500 hover:underline" onClick={() => confirm("Delete?") && startDel(() => deleteAnswer(a.id))}>Delete</button>}
      </div>
    </form>
  );
}

// ---------- Settings ----------

export function TelegramTools() {
  const [msg, setMsg] = useState("");
  const [chats, setChats] = useState<{ id: number; name: string }[]>([]);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={pending} onClick={() => start(async () => { const r = await findTelegramChats(); setChats(r.chats); setMsg(r.error ?? (r.chats.length ? "" : "No chats found. Send /start to your bot first, then retry.")); })}>Detect my chat ID</button>
        <button className="btn-secondary" disabled={pending} onClick={() => start(async () => { const r = await testTelegram(); setMsg(r.error ?? "Test message sent ✓"); })}>Send test message</button>
      </div>
      {chats.map((c) => <div key={c.id} className="font-mono text-sm">{c.name}: <b>{c.id}</b></div>)}
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
    </div>
  );
}
