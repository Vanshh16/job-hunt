import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { norm } from "@/lib/fieldmap";

/** Save question/answer pairs to the answer bank (upsert by normalized question). */
export const POST = handler(async (req) => {
  const { items } = (await req.json()) as { items?: { question: string; answer: string }[] };
  const all = await prisma.answer.findMany({ select: { id: true, question: true } });
  const byQ = new Map(all.map((a) => [norm(a.question), a.id]));
  let saved = 0;
  for (const it of items ?? []) {
    const q = it.question?.trim();
    const a = it.answer?.trim();
    if (!q || !a || q.length > 1000) continue;
    const id = byQ.get(norm(q));
    if (id) await prisma.answer.update({ where: { id }, data: { answer: a } });
    else await prisma.answer.create({ data: { question: q, answer: a } });
    saved++;
  }
  return NextResponse.json({ saved });
});
