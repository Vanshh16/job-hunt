"use client";

import { useMemo, useState, useTransition } from "react";
import { setTelegramChats } from "@/app/actions";

export type ChatRow = {
  id: string;
  title: string;
  username: string | null;
  kind: string;
  enabled: boolean;
  messages: number;
  jobs: number;
  lastSync: string | null;
};

const JOBBY = /job|hiring|intern|placement|career|referr|opening|recruit|fresher|sde|developer|tech|campus|off.?campus/i;

export function TelegramGroups({ chats, lastUpload }: { chats: ChatRow[]; lastUpload: string | null }) {
  const [selected, setSelected] = useState(() => new Set(chats.filter((c) => c.enabled).map((c) => c.id)));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "selected" | "suggested">("all");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const initial = useMemo(() => new Set(chats.filter((c) => c.enabled).map((c) => c.id)), [chats]);
  const dirty = selected.size !== initial.size || [...selected].some((id) => !initial.has(id));

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return chats
      .filter((c) => !needle || c.title.toLowerCase().includes(needle) || c.username?.toLowerCase().includes(needle))
      .filter((c) => (filter === "selected" ? selected.has(c.id) : filter === "suggested" ? JOBBY.test(c.title) : true))
      .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || Number(JOBBY.test(b.title)) - Number(JOBBY.test(a.title)) || a.title.localeCompare(b.title));
  }, [chats, q, filter, selected]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (!chats.length) {
    return (
      <p className="muted">
        No groups yet. The list appears after the worker&apos;s next sync (GitHub Actions → &ldquo;Telegram job sync&rdquo; → Run workflow).
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search groups…" value={q} onChange={(e) => setQ(e.target.value)} />
        {(["all", "selected", "suggested"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm ${filter === f ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}
          >
            {f === "all" ? `All ${chats.length}` : f === "selected" ? `Selected ${selected.size}` : "Looks job-related"}
          </button>
        ))}
      </div>

      <ul className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 bg-white">
        {rows.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
              <input type="checkbox" className="size-4 accent-brand-600" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{c.title}</div>
                <div className="truncate text-xs text-gray-500">
                  {c.kind}
                  {c.username ? ` · @${c.username}` : ""}
                  {c.messages ? ` · ${c.messages} posts read · ${c.jobs} jobs found` : ""}
                </div>
              </div>
              {JOBBY.test(c.title) && !selected.has(c.id) && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">suggested</span>}
            </label>
          </li>
        ))}
        {!rows.length && <li className="p-4 text-center text-sm text-gray-500">No matches.</li>}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn-primary"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const r = await setTelegramChats([...selected]);
              setMsg(`Saved — ${r.count} group(s) will be read from the next sync.`);
            })
          }
        >
          {pending ? "Saving…" : "Save selection"}
        </button>
        {dirty && !pending && <span className="text-sm text-amber-700">Unsaved changes</span>}
        {msg && !dirty && <span className="text-sm text-emerald-600">{msg}</span>}
      </div>
      <p className="text-xs text-gray-400">
        Newly ticked groups start with their last 30 posts. The list refreshes on every sync{lastUpload ? ` (last: ${lastUpload})` : ""}; join a group in Telegram and it shows up here after the next sync.
      </p>
    </div>
  );
}
