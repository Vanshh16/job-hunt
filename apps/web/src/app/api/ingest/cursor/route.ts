import { NextResponse } from "next/server";
import { bad, handler } from "@/lib/api";
import { prisma } from "@/lib/db";

/** Worker: highest Telegram message id already ingested for a chat (0 if none). */
export const GET = handler(async (req) => {
  const chat = new URL(req.url).searchParams.get("chat");
  if (!chat) return bad("chat required");
  const last = await prisma.telegramMessage.findFirst({ where: { chat }, orderBy: { messageId: "desc" }, select: { messageId: true } });
  return NextResponse.json({ lastMessageId: last?.messageId ?? 0 });
});
