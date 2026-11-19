import OpenAI from "openai";

// Google Gemini via its OpenAI-compatible endpoint (free tier: https://aistudio.google.com/apikey).
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

let client: OpenAI | null = null;
function openai() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  // Free tier has low per-minute limits; the SDK retries 429s with exponential backoff.
  client ??= new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: GEMINI_BASE_URL, maxRetries: 5, timeout: 55_000 });
  return client;
}

// "-latest" aliases track Google's current model, so retirements of numbered versions don't break the app.
export const AI_MODEL = () => process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

function extraParams(): Record<string, unknown> {
  // Optional: "none" | "low" | "medium" | "high" — limits Gemini 2.5 "thinking" for speed.
  return process.env.GEMINI_REASONING_EFFORT ? { reasoning_effort: process.env.GEMINI_REASONING_EFFORT } : {};
}
const MODEL = AI_MODEL;

/**
 * Stronger models used for WRITING (form answers, cover letters, outreach), tried in order.
 * On the free tier these are often "503 high demand", so each gets one short attempt and we
 * fall back to the fast default model — writing never fails, it just uses the best model available.
 */
export const WRITING_MODELS = () =>
  (process.env.GEMINI_WRITING_MODELS ?? "gemini-3.8-flash,gemini-3-flash-preview")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const WRITING_ATTEMPT_MS = 22_000; // per strong-model attempt
const WRITING_BUDGET_MS = 30_000; // stop trying strong models after this, leave time for the fallback

type Opts = { writing?: boolean };

async function complete(messages: OpenAI.Chat.ChatCompletionMessageParam[], json: boolean, opts: Opts = {}) {
  const base = { messages, ...(json ? { response_format: { type: "json_object" as const } } : {}), ...extraParams() };
  const started = Date.now();
  if (opts.writing) {
    for (const model of WRITING_MODELS()) {
      if (model === MODEL() || Date.now() - started > WRITING_BUDGET_MS) break;
      try {
        const res = await openai().chat.completions.create({ ...base, model } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, {
          timeout: WRITING_ATTEMPT_MS,
          maxRetries: 0,
        });
        const text = res.choices[0]?.message?.content;
        if (text?.trim()) {
          console.info(`[ai] writing done with ${model}`);
          return text;
        }
      } catch (e) {
        console.warn(`[ai] ${model} unavailable (${e instanceof Error ? e.message.slice(0, 80) : e}); trying next`);
      }
    }
  }
  const res = await openai().chat.completions.create({ ...base, model: MODEL() } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  return res.choices[0]?.message?.content ?? "";
}

export async function chatJSON<T>(system: string, user: string, opts: Opts = {}): Promise<T> {
  const text =
    (await complete(
      [
        { role: "system", content: system + "\nAlways reply with a single valid JSON object." },
        { role: "user", content: user },
      ],
      true,
      opts,
    )) || "{}";
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : "{}") as T;
  }
}

export async function chatText(system: string, user: string, opts: Opts = {}): Promise<string> {
  const text = await complete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    false,
    opts,
  );
  return text.trim();
}

export const clip = (s: string | null | undefined, n: number) => (s ?? "").slice(0, n);

// ---------- Job extraction ----------

export type ExtractedJob = {
  title: string;
  company: string;
  location?: string;
  url?: string;
  applyType?: string;
  applyEmail?: string;
  description?: string;
  salary?: string;
  experience?: string;
  eligibility?: string;
  deadline?: string; // ISO date
};

export async function extractJobs(text: string, today = new Date()): Promise<ExtractedJob[]> {
  const out = await chatJSON<{ jobs?: ExtractedJob[] }>(
    `You extract job openings from messages (Telegram posts, job pages, emails).
Return {"jobs":[...]} with one entry per distinct opening. A post may contain several companies/roles; a post may contain none (ads, chit-chat, course promotions => return {"jobs":[]}).
Fields per job: title, company, location, url (the best apply link: company portal, ATS, Google Form, or LinkedIn link; never a Telegram/WhatsApp/shortener-promo link if a real one exists),
applyType ("portal" | "google_form" | "email" | "linkedin" | "other"), applyEmail (if applying by email), description (concise summary of responsibilities + requirements, max 1200 chars, keep key skills),
salary, experience (e.g. "0-2 years", "Freshers"), eligibility (batch years / degrees if mentioned), deadline (ISO yyyy-mm-dd if a last date is mentioned; today is ${today.toISOString().slice(0, 10)}).
Use null for unknown fields. Do not invent companies or links.`,
    clip(text, 14000),
  );
  return (out.jobs ?? []).filter((j) => j && j.title && j.company);
}

// ---------- Matching ----------

export type ResumeLite = { id: string; label: string; text: string };

export type MatchResult = {
  score: number;
  summary: string;
  bestResumeId: string | null;
  resumeFit: { resumeId: string; score: number; reason: string }[];
  matchedSkills: string[];
  missingSkills: string[];
  resumeAdvice: string;
  redFlags: string[];
};

const MATCH_SYSTEM = `You are a candid career coach scoring how well a job fits a candidate.
Score 0-100 overall fit considering: role match with target roles, experience requirement vs candidate level, skills overlap with the best resume, location fit, eligibility (batch/degree).
Heavily penalize jobs needing much more experience than the candidate has, or matching exclude keywords.
If no resumes are provided, score from the candidate preferences alone and say in resumeAdvice that a resume should be uploaded for accurate matching.
Evaluate EACH resume separately and pick the best one. If the best resume scores below 55 for this job, resumeAdvice must list concrete edits (skills/projects/keywords to add or reorder) the candidate should make manually; otherwise say which resume to use and why in one sentence.
Fields: {"score":int,"summary":"1-2 sentences","bestResumeId":string|null,"resumeFit":[{"resumeId","score","reason"}],"matchedSkills":[],"missingSkills":[],"resumeAdvice":"","redFlags":[]}`;

export async function matchJob(
  job: { title: string; company: string; description?: string | null; experience?: string | null; eligibility?: string | null; location?: string | null },
  resumes: ResumeLite[],
  prefs: { targetRoles: string; locations: string; experienceLevel: string; mustHaveKeywords: string; excludeKeywords: string },
): Promise<MatchResult> {
  const out = await chatJSON<Partial<MatchResult>>(
    `${MATCH_SYSTEM}\nReturn JSON with exactly those fields.`,
    JSON.stringify({
      candidatePreferences: prefs,
      job: { ...job, description: clip(job.description, 6000) },
      resumes: resumes.map((r) => ({ resumeId: r.id, label: r.label, text: clip(r.text, 6000) })),
    }),
  );
  return normalizeMatch(out, resumes);
}

type JobForMatch = Parameters<typeof matchJob>[0];

/** Score several jobs in ONE call (keeps us inside free-tier per-minute limits). Missing entries come back null. */
export async function matchJobs(jobs: JobForMatch[], resumes: ResumeLite[], prefs: Parameters<typeof matchJob>[2]): Promise<(MatchResult | null)[]> {
  if (jobs.length === 1) return [await matchJob(jobs[0], resumes, prefs)];
  const out = await chatJSON<{ results?: (Partial<MatchResult> & { index?: number })[] }>(
    `${MATCH_SYSTEM}
You are given several jobs. Return {"results":[...]} with one object per job, each including "index" (the job's index) plus all the fields above.`,
    JSON.stringify({
      candidatePreferences: prefs,
      jobs: jobs.map((j, index) => ({ index, ...j, description: clip(j.description, 2500) })),
      resumes: resumes.map((r) => ({ resumeId: r.id, label: r.label, text: clip(r.text, 5000) })),
    }),
  );
  const byIndex = new Map((out.results ?? []).map((r, i) => [typeof r.index === "number" ? r.index : i, r]));
  return jobs.map((_, i) => {
    const r = byIndex.get(i);
    return r && Number.isFinite(Number(r.score)) ? normalizeMatch(r, resumes) : null;
  });
}

function normalizeMatch(out: Partial<MatchResult>, resumes: ResumeLite[]): MatchResult {
  if (!Number.isFinite(Number(out.score))) throw new Error("AI returned no score");
  const ids = new Set(resumes.map((r) => r.id));
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(out.score)))),
    summary: out.summary ?? "",
    bestResumeId: out.bestResumeId && ids.has(out.bestResumeId) ? out.bestResumeId : resumes[0]?.id ?? null,
    resumeFit: (out.resumeFit ?? []).filter((r) => ids.has(r.resumeId)),
    matchedSkills: out.matchedSkills ?? [],
    missingSkills: out.missingSkills ?? [],
    resumeAdvice: out.resumeAdvice ?? "",
    redFlags: out.redFlags ?? [],
  };
}

// ---------- Form answers ----------

export type FormFieldIn = {
  id: string;
  label: string;
  type: string; // text | textarea | email | tel | number | date | url | select | radio | checkbox | combobox
  options?: string[];
  required?: boolean;
  maxLength?: number;
};

export async function answerFields(input: {
  fields: FormFieldIn[];
  profile: Record<string, string>;
  answerBank: { question: string; answer: string }[];
  job?: { title?: string; company?: string; description?: string | null } | null;
  resumeText?: string;
}): Promise<Record<string, string | string[]>> {
  if (!input.fields.length) return {};
  const out = await chatJSON<{ answers?: { id: string; value: string | string[] }[] }>(
    `You fill job application forms on behalf of the candidate, using ONLY facts from their profile, resume and saved answers.
Rules:
- For select/radio fields, value MUST be exactly one of the given options. For checkbox groups return an array of options (or [] ).
- Never invent facts (numbers, dates, employers, degrees). If the information is not available and the field is not an open-ended question, return "".
- Open-ended questions ("why do you want to join", "describe a project", cover-letter style): write a genuine, specific answer in first person, 50-120 words unless maxLength is smaller, referencing the job and the candidate's real experience. No clichés, no placeholders.
- Yes/no eligibility questions: answer truthfully from the profile; if a reasonable default is clear (e.g. willing to work from office), answer accordingly.
- Respect maxLength.
Return {"answers":[{"id","value"}]} for every field id.`,
    JSON.stringify({
      fields: input.fields,
      profile: input.profile,
      savedAnswers: input.answerBank.slice(0, 40),
      job: input.job ? { ...input.job, description: clip(input.job.description, 4000) } : null,
      resume: clip(input.resumeText, 6000),
    }),
    { writing: true },
  );
  const map: Record<string, string | string[]> = {};
  for (const a of out.answers ?? []) if (a?.id != null) map[a.id] = a.value ?? "";
  return map;
}

// ---------- Writing ----------

export async function writeCoverLetter(job: { title: string; company: string; description?: string | null }, resumeText: string, profile: Record<string, string>, extra?: string) {
  return chatText(
    `Write a concise, specific cover letter (180-250 words) for the candidate. Plain text, no placeholders like [Company]. Open with a hook tied to the company/role, connect 2-3 concrete experiences/projects from the resume to the job's requirements, close with a confident call to action. Sign with the candidate's name.`,
    JSON.stringify({ job: { ...job, description: clip(job.description, 5000) }, resume: clip(resumeText, 6000), candidate: profile, extraInstructions: extra ?? "" }),
    { writing: true },
  );
}

export type OutreachKind = "referral" | "recruiter" | "followup" | "thankyou";

export async function writeOutreach(kind: OutreachKind, job: { title: string; company: string; description?: string | null }, resumeText: string, profile: Record<string, string>, extra?: string) {
  const brief: Record<OutreachKind, string> = {
    referral: "a LinkedIn message (max 300 chars for the connection note, then a longer follow-up message of ~100 words) to an employee asking for a referral. Output both, labelled 'Connection note:' and 'Message:'.",
    recruiter: "a short cold email to a recruiter/hiring manager (subject line + 90-130 word body) expressing interest and highlighting the 2 most relevant qualifications.",
    followup: "a polite follow-up email (subject + ~80 words) checking on the application status a week after applying.",
    thankyou: "a thank-you email (subject + ~90 words) after an interview, referencing the role.",
  };
  return chatText(
    `You draft outreach messages for a job seeker. Write ${brief[kind]} Be warm, specific and human, never generic or desperate. Use [Name] only for the recipient's name.`,
    JSON.stringify({ job: { ...job, description: clip(job.description, 3000) }, resume: clip(resumeText, 4000), candidate: profile, extraInstructions: extra ?? "" }),
    { writing: true },
  );
}
