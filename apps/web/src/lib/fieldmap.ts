import { PROFILE_FIELDS, fullNameOf } from "./profile";
import type { FormFieldIn } from "./ai";

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\*/g, " ")
    .replace(/[^a-z0-9+#.\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 2));

export function similarity(a: string, b: string) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Pick the option that best matches a desired value (for selects/radios). */
export function pickOption(value: string, options: string[]): string | null {
  if (!value || !options.length) return null;
  const v = norm(value);
  const opts = options.map((o) => ({ o, n: norm(o) })).filter((x) => x.n && !/^(select|choose|--|please select)/.test(x.n));
  const exact = opts.find((x) => x.n === v);
  if (exact) return exact.o;
  const yes = /^(yes|y|true|willing|immediate(ly)?)\b/.test(v);
  const no = /^(no|n|false|not)\b/.test(v);
  if (yes) {
    const o = opts.find((x) => /^yes\b/.test(x.n));
    if (o) return o.o;
  }
  if (no) {
    const o = opts.find((x) => /^no\b/.test(x.n));
    if (o) return o.o;
  }
  const contains = opts.find((x) => x.n.includes(v) || v.includes(x.n));
  if (contains) return contains.o;
  let best: { o: string; s: number } | null = null;
  for (const x of opts) {
    const s = similarity(x.n, v);
    if (!best || s > best.s) best = { o: x.o, s };
  }
  return best && best.s >= 0.5 ? best.o : null;
}

type Bank = { id: string; question: string; answer: string }[];

// Labels about someone other than the candidate must never get the candidate's own details.
const OTHER_PERSON = /\b(referr(er|al)|reference|recruiter|manager|supervisor|father|mother|parent|guardian|spouse|emergency|nominee|hr\b|interviewer)/;

/**
 * Deterministic fill: profile patterns + exact-ish answer-bank matches.
 * Returns filled values plus the fields that still need AI.
 */
export function deterministicFill(fields: FormFieldIn[], profile: Record<string, string>, bank: Bank) {
  const values: Record<string, string | string[]> = {};
  const sources: Record<string, "profile" | "bank" | "ai"> = {};
  const usedBank = new Set<string>();
  const rest: FormFieldIn[] = [];
  const derived: Record<string, string> = { ...profile, fullName: fullNameOf(profile) };
  if (!derived.firstName && derived.fullName) derived.firstName = derived.fullName.split(" ")[0];
  if (!derived.lastName && derived.fullName) derived.lastName = derived.fullName.split(" ").slice(1).join(" ");

  for (const f of fields) {
    if (f.type === "file") continue;
    const label = norm(f.label);
    if (!label) continue;
    let value: string | null = null;

    // 1. Saved answers (high similarity)
    let bestBank: { a: Bank[number]; s: number } | null = null;
    for (const a of bank) {
      const s = norm(a.question) === label ? 1 : similarity(a.question, f.label);
      if (!bestBank || s > bestBank.s) bestBank = { a, s };
    }
    if (bestBank && bestBank.s >= 0.75) {
      value = bestBank.a.answer;
      sources[f.id] = "bank";
      usedBank.add(bestBank.a.id);
    }

    // 2. Profile patterns (only for short labels — long labels are usually real questions)
    if (value == null && label.length <= 90 && !OTHER_PERSON.test(label)) {
      for (const def of PROFILE_FIELDS) {
        if (def.patterns?.some((p) => p.test(label))) {
          const v = derived[def.key];
          if (v) {
            value = v;
            sources[f.id] = "profile";
          }
          break;
        }
      }
    }

    if (value != null && f.options?.length) {
      if (f.type === "checkbox") {
        const parts = value.split(/[,;\n]/).map((p) => pickOption(p.trim(), f.options!)).filter(Boolean) as string[];
        if (parts.length) values[f.id] = parts;
        else value = null;
      } else {
        const picked = pickOption(value, f.options);
        if (picked) values[f.id] = picked;
        else value = null;
      }
    } else if (value != null) {
      values[f.id] = f.maxLength ? value.slice(0, f.maxLength) : value;
    }

    if (value == null) {
      delete sources[f.id];
      rest.push(f);
    }
  }
  return { values, sources, rest, usedBank: [...usedBank] };
}

/** Rank answer-bank entries by relevance to the remaining questions (for the AI prompt). */
export function relevantBank(bank: Bank, fields: FormFieldIn[], limit = 25) {
  const text = fields.map((f) => f.label).join(" ");
  return bank
    .map((a) => ({ a, s: similarity(a.question, text) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, limit)
    .map((x) => ({ question: x.a.question, answer: x.a.answer }));
}
