import { NextResponse } from "next/server";
import type { JobStatus } from "@prisma/client";
import { bad, handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { STATUSES, companyFromUrl, dedupeKeyFor, normalizeUrl, setStatus, upsertExtractedJob } from "@/lib/jobs";

/** Extension: set status of a job (creating a minimal job record from the page if needed). */
export const POST = handler(async (req) => {
  const b = (await req.json()) as { jobId?: string; status?: JobStatus; url?: string; title?: string; company?: string; notes?: string };
  if (!b.status || !STATUSES.includes(b.status)) return bad("Invalid status");
  let jobId = b.jobId;
  if (!jobId) {
    const nurl = normalizeUrl(b.url);
    const found = nurl ? await prisma.job.findFirst({ where: { url: nurl } }) : null;
    if (found) jobId = found.id;
    else {
      if (!b.title) return bad("title required for a new job");
      const company = b.company || companyFromUrl(b.url);
      const existing = await prisma.job.findUnique({ where: { dedupeKey: dedupeKeyFor({ url: b.url, company, title: b.title }) } });
      jobId = existing?.id ?? (await upsertExtractedJob({ title: b.title, company, url: b.url }, "extension", b.url))[0].id;
    }
  }
  if (b.notes) await prisma.job.update({ where: { id: jobId }, data: { notes: b.notes } });
  const job = await setStatus(jobId, b.status);
  return NextResponse.json({ job });
});
