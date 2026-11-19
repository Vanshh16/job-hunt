import { NextResponse } from "next/server";
import { bad, handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { writeCoverLetter, writeOutreach, type OutreachKind } from "@/lib/ai";
import { getProfile } from "@/lib/profile";
import { logActivity } from "@/lib/jobs";

export const maxDuration = 60;

/** Generate a cover letter or outreach message for a job. */
export const POST = handler(async (req) => {
  const { jobId, kind, extra } = (await req.json()) as { jobId?: string; kind?: "cover" | OutreachKind; extra?: string };
  if (!jobId || !kind) return bad("jobId and kind required");
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return bad("Job not found", 404);
  const { fields } = await getProfile();
  const resume = job.bestResumeId
    ? await prisma.resume.findUnique({ where: { id: job.bestResumeId }, select: { text: true } })
    : await prisma.resume.findFirst({ select: { text: true } });
  const text =
    kind === "cover"
      ? await writeCoverLetter(job, resume?.text ?? "", fields, extra)
      : await writeOutreach(kind, job, resume?.text ?? "", fields, extra);
  if (kind === "cover") await prisma.job.update({ where: { id: jobId }, data: { coverLetter: text } });
  await logActivity(jobId, "generate", `Generated ${kind === "cover" ? "cover letter" : `${kind} message`}`);
  return NextResponse.json({ text });
});
