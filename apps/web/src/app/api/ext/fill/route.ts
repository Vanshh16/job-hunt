import { NextResponse } from "next/server";
import { bad, handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { answerFields, type FormFieldIn } from "@/lib/ai";
import { deterministicFill, relevantBank } from "@/lib/fieldmap";
import { getProfile } from "@/lib/profile";
import { normalizeUrl } from "@/lib/jobs";

export const maxDuration = 60;

/**
 * Extension: given the form fields scanned on a page, return values for each.
 * Profile + answer bank first (instant, exact), AI for whatever is left.
 */
export const POST = handler(async (req) => {
  const body = (await req.json()) as { fields?: FormFieldIn[]; jobId?: string; url?: string; pageText?: string; useAi?: boolean; resumeId?: string };
  const fields = (body.fields ?? []).slice(0, 150);
  if (!fields.length) return bad("No form fields found on this page");

  const [{ fields: profile }, bank] = await Promise.all([getProfile(), prisma.answer.findMany()]);
  const nurl = normalizeUrl(body.url);
  const job = body.jobId
    ? await prisma.job.findUnique({ where: { id: body.jobId } })
    : nurl
      ? await prisma.job.findFirst({ where: { url: nurl } })
      : null;

  const resumeId = body.resumeId || job?.bestResumeId || (await prisma.resume.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id || (await prisma.resume.findFirst({ select: { id: true } }))?.id || null;
  const resume = resumeId ? await prisma.resume.findUnique({ where: { id: resumeId }, select: { text: true } }) : null;

  const { values, sources, rest, usedBank } = deterministicFill(fields, profile, bank);

  if (body.useAi !== false && rest.length) {
    const ai = await answerFields({
      fields: rest,
      profile,
      answerBank: relevantBank(bank, rest),
      job: job ? { title: job.title, company: job.company, description: job.description } : body.pageText ? { description: body.pageText.slice(0, 4000) } : null,
      resumeText: resume?.text,
    });
    for (const f of rest) {
      const v = ai[f.id];
      if (v == null || (Array.isArray(v) ? !v.length : !String(v).trim())) continue;
      values[f.id] = v;
      sources[f.id] = "ai";
    }
  }

  if (usedBank.length) await prisma.answer.updateMany({ where: { id: { in: usedBank } }, data: { uses: { increment: 1 } } });

  return NextResponse.json({ values, sources, resumeId, jobId: job?.id ?? null });
});
