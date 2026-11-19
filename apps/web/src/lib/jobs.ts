import type { Job, JobStatus, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { extractJobs, matchJob, matchJobs, type ExtractedJob, type MatchResult } from "./ai";
import { getProfile } from "./profile";
import { escapeHtml, notify } from "./telegram";

export const STATUSES: JobStatus[] = ["NEW", "SAVED", "APPLIED", "OA", "INTERVIEW", "OFFER", "REJECTED", "GHOSTED", "DISMISSED"];
export const PIPELINE: JobStatus[] = ["SAVED", "APPLIED", "OA", "INTERVIEW", "OFFER", "REJECTED", "GHOSTED"];

export function normalizeUrl(url?: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    // Drop tracking params; keep ones that identify the posting.
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref|refId|trackingId|trk|src|source|lipi|fbclid|gclid|gh_src|lever-source|lever-origin)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = "";
    // LinkedIn: canonicalize /jobs/view/<id>
    const li = u.hostname.includes("linkedin.com") && (u.pathname.match(/\/jobs\/view\/(\d+)/) || [null, u.searchParams.get("currentJobId")]);
    if (li && li[1]) return `https://www.linkedin.com/jobs/view/${li[1]}`;
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

/** Best-effort company name from a URL (ATS slugs like boards.greenhouse.io/<company>/…). */
export function companyFromUrl(url?: string | null) {
  if (!url) return "Unknown";
  try {
    const u = new URL(url);
    const slug = u.pathname.split("/").filter(Boolean)[0];
    if (/greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com/.test(u.hostname) && slug) {
      return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
    const wd = u.hostname.match(/^([^.]+)\.(wd\d+\.)?myworkdayjobs\.com$/);
    if (wd) return wd[1].replace(/\b\w/g, (c) => c.toUpperCase());
    return u.hostname.replace(/^(www|careers|jobs|apply)\./, "");
  } catch {
    return "Unknown";
  }
}

/** URLs that identify exactly one job posting (vs. feed posts / roundup links / shorteners shared by many jobs). */
const POSTING_URL =
  /linkedin\.com\/jobs\/view\/\d+|greenhouse\.io\/.+\/jobs\/\d+|jobs\.lever\.co\/[^/]+\/[0-9a-f-]{20,}|jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{20,}|myworkdayjobs\.com\/.+\/job\/|smartrecruiters\.com\/[^/]+\/\d+|docs\.google\.com\/forms\/|forms\.gle\/|wellfound\.com\/jobs\/\d+|naukri\.com\/job-listings-|instahyre\.com\/job-/i;

export function dedupeKeyFor(j: { url?: string | null; company: string; title: string }) {
  const url = normalizeUrl(j.url);
  if (url && POSTING_URL.test(url)) return `url:${url.toLowerCase()}`;
  // Roundup posts often share one link for many jobs, and the same job is cross-posted across groups:
  // company + title is the reliable identity there.
  return `ct:${j.company.toLowerCase().replace(/\W+/g, "")}|${j.title.toLowerCase().replace(/\W+/g, "")}`;
}

function parseDate(s?: string | null) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function logActivity(jobId: string | null, type: string, message: string) {
  await prisma.activity.create({ data: { jobId, type, message } });
}

/** Insert (or find existing) job from extracted data. Returns [job, created]. */
export async function upsertExtractedJob(e: ExtractedJob, source: string, sourceRef?: string, rawText?: string): Promise<[Job, boolean]> {
  const dedupeKey = dedupeKeyFor({ url: e.url, company: e.company, title: e.title });
  const existing = await prisma.job.findUnique({ where: { dedupeKey } });
  if (existing) return [existing, false];
  const job = await prisma.job.create({
    data: {
      dedupeKey,
      title: e.title.slice(0, 300),
      company: e.company.slice(0, 200),
      location: e.location ?? null,
      url: normalizeUrl(e.url),
      applyType: e.applyType ?? null,
      applyEmail: e.applyEmail ?? null,
      description: e.description ?? null,
      salary: e.salary ?? null,
      experience: e.experience ?? null,
      eligibility: e.eligibility ?? null,
      deadline: parseDate(e.deadline),
      source,
      sourceRef: sourceRef ?? null,
      rawText: rawText?.slice(0, 20000) ?? null,
    },
  });
  await logActivity(job.id, "created", `Found via ${source}`);
  return [job, true];
}

export async function scoreJob(jobId: string): Promise<{ job: Job; match: MatchResult } | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  const [resumes, { preferences }] = await Promise.all([
    prisma.resume.findMany({ select: { id: true, label: true, text: true } }),
    getProfile(),
  ]);
  const match = await matchJob(job, resumes, preferences);
  return { job: await saveMatch(jobId, match), match };
}

function saveMatch(jobId: string, match: MatchResult) {
  return prisma.job.update({
    where: { id: jobId },
    data: {
      matchScore: match.score,
      matchSummary: match.summary,
      bestResumeId: match.bestResumeId,
      analysis: match as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function notifyMatch(job: Job, match: MatchResult) {
  const appUrl = process.env.APP_URL || "";
  const resume = match.bestResumeId ? await prisma.resume.findUnique({ where: { id: match.bestResumeId }, select: { label: true } }) : null;
  const lines = [
    `<b>${escapeHtml(job.title)}</b> @ <b>${escapeHtml(job.company)}</b>  —  ${match.score}/100`,
    job.location ? `📍 ${escapeHtml(job.location)}` : "",
    job.experience ? `🧑‍💻 ${escapeHtml(job.experience)}` : "",
    job.deadline ? `⏰ Deadline: ${job.deadline.toDateString()}` : "",
    "",
    escapeHtml(match.summary),
    resume ? `📄 Use resume: <b>${escapeHtml(resume.label)}</b>` : "",
    match.score < 70 && match.resumeAdvice ? `✏️ ${escapeHtml(match.resumeAdvice.slice(0, 300))}` : "",
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""));
  const buttons: { text: string; url: string }[][] = [[]];
  if (job.url && /^https?:/.test(job.url)) buttons[0].push({ text: "Apply", url: job.url });
  if (appUrl.startsWith("https://")) buttons[0].push({ text: "Open in dashboard", url: `${appUrl}/jobs/${job.id}` });
  await notify(lines.join("\n"), buttons[0].length ? buttons : undefined);
}

/** Full pipeline: text -> extracted jobs -> dedupe -> score -> notify. */
export async function ingestText(text: string, source: string, sourceRef?: string, opts: { notify?: boolean } = {}) {
  const extracted = await extractJobs(text);
  const results: { job: Job; created: boolean; score: number | null }[] = [];
  for (const e of extracted) {
    const [job, created] = await upsertExtractedJob(e, source, sourceRef, text);
    results.push({ job, created, score: job.matchScore });
  }

  // Score all new jobs from this post together: one AI call per batch instead of one per job.
  const fresh = results.filter((r) => r.created);
  if (fresh.length) {
    const [resumes, { preferences }] = await Promise.all([
      prisma.resume.findMany({ select: { id: true, label: true, text: true } }),
      getProfile(),
    ]);
    for (let i = 0; i < fresh.length; i += 8) {
      const batch = fresh.slice(i, i + 8);
      let matches: (MatchResult | null)[] = [];
      try {
        matches = await matchJobs(batch.map((r) => r.job), resumes, preferences);
      } catch (err) {
        console.error("batch scoring failed", err);
      }
      for (const [k, r] of batch.entries()) {
        const m = matches[k];
        if (!m) continue; // left unscored (null) — "Re-score open jobs" on the Resumes page picks these up
        r.job = await saveMatch(r.job.id, m);
        r.score = m.score;
        if (opts.notify !== false && m.score >= preferences.minScoreToNotify) await notifyMatch(r.job, m).catch(console.error);
      }
    }
  }
  return results;
}

export async function setStatus(jobId: string, status: JobStatus) {
  const { preferences } = await getProfile();
  const data: Prisma.JobUpdateInput = { status };
  if (status === "APPLIED") {
    data.appliedAt = new Date();
    data.followUpAt = new Date(Date.now() + preferences.followUpDays * 86400000);
  }
  if (["REJECTED", "OFFER", "DISMISSED", "GHOSTED"].includes(status)) data.followUpAt = null;
  const job = await prisma.job.update({ where: { id: jobId }, data });
  await logActivity(jobId, "status", `Status → ${status}`);
  return job;
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  NEW: "New",
  SAVED: "Saved",
  APPLIED: "Applied",
  OA: "Assessment",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
  GHOSTED: "Ghosted",
  DISMISSED: "Dismissed",
};
