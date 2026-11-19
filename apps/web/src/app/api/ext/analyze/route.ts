import { NextResponse } from "next/server";
import { bad, handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { extractJobs } from "@/lib/ai";
import { companyFromUrl, dedupeKeyFor, normalizeUrl, scoreJob, upsertExtractedJob } from "@/lib/jobs";

export const maxDuration = 60;

/** Extension: analyze the job on the current page. Creates the job if new, scores it, returns analysis. */
export const POST = handler(async (req) => {
  const { url, pageTitle, pageText, force } = (await req.json()) as { url?: string; pageTitle?: string; pageText?: string; force?: boolean };
  if (!pageText || pageText.length < 80) return bad("Not enough text on this page to analyze");

  // Already known by URL?
  const nurl = normalizeUrl(url);
  let job = nurl ? await prisma.job.findFirst({ where: { url: nurl } }) : null;

  if (!job) {
    const extracted = await extractJobs(`Page URL: ${url}\nPage title: ${pageTitle}\n\n${pageText}`);
    const e = extracted[0] ?? { title: pageTitle || "Unknown role", company: companyFromUrl(url), description: pageText.slice(0, 1500) };
    // The page itself is where you apply (unless it's a Google Form link elsewhere).
    if (url && (!e.url || /linkedin\.com\/jobs|greenhouse|lever\.co|ashbyhq|workday|myworkdayjobs|smartrecruiters|docs\.google\.com\/forms/i.test(url))) e.url = url;
    const existing = await prisma.job.findUnique({ where: { dedupeKey: dedupeKeyFor({ url: e.url, company: e.company, title: e.title }) } });
    job = existing ?? (await upsertExtractedJob(e, "extension", url, pageText))[0];
  }

  if (force || job.matchScore == null) {
    const scored = await scoreJob(job.id);
    if (scored) job = scored.job;
  }
  if (job.status === "NEW") job = await prisma.job.update({ where: { id: job.id }, data: { status: "SAVED" } });

  return NextResponse.json({ job });
});
