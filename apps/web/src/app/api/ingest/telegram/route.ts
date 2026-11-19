import { NextResponse } from "next/server";
import { bad, handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ingestText } from "@/lib/jobs";

export const maxDuration = 60;

/** Worker: ingest one Telegram message. Idempotent per chat+messageId. */
export const POST = handler(async (req) => {
  const { chat, messageId, text, link } = (await req.json()) as { chat?: string; messageId?: number; text?: string; link?: string };
  if (!chat || messageId == null) return bad("chat and messageId required");
  const id = `${chat}:${messageId}`;
  if (await prisma.telegramMessage.findUnique({ where: { id } })) return NextResponse.json({ skipped: true });

  let jobsFound = 0;
  let created = 0;
  // Skip tiny messages (stickers, "thanks", etc.) without spending an AI call.
  if (text && text.trim().length >= 60) {
    const results = await ingestText(text, "telegram", link ?? id);
    jobsFound = results.length;
    created = results.filter((r) => r.created).length;
  }
  await prisma.telegramMessage.create({ data: { id, chat, messageId, jobsFound } });
  return NextResponse.json({ jobsFound, created });
});
