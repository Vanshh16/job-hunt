import { NextResponse } from "next/server";
import { bad, handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";

export const maxDuration = 60;

type ChatIn = { id: string; title: string; username?: string | null; kind: string };

/**
 * Worker: upload the groups/channels the Telegram account can see; returns which ones to sync.
 * Until you pick groups in the dashboard, the worker's TELEGRAM_GROUPS (`envGroups`) are adopted as the selection.
 */
export const POST = handler(async (req) => {
  const { chats, envGroups } = (await req.json()) as { chats?: ChatIn[]; envGroups?: string[] };
  if (!Array.isArray(chats)) return bad("chats required");
  const now = new Date();
  const valid = chats.filter((c) => c?.id && c.title).slice(0, 1000);
  for (let i = 0; i < valid.length; i += 100) {
    await prisma.$transaction(
      valid.slice(i, i + 100).map((c) =>
        prisma.telegramChat.upsert({
          where: { id: String(c.id) },
          update: { title: c.title.slice(0, 200), username: c.username ?? null, kind: c.kind, seenAt: now },
          create: { id: String(c.id), title: c.title.slice(0, 200), username: c.username ?? null, kind: c.kind, seenAt: now },
        }),
      ),
    );
  }

  let managed = (await getSetting<boolean>("telegramManaged")) === true;
  if (!managed && envGroups?.length) {
    await prisma.telegramChat.updateMany({ where: { id: { in: envGroups.map(String) } }, data: { enabled: true } });
    await setSetting("telegramManaged", true);
    managed = true;
  }
  const groups = managed ? (await prisma.telegramChat.findMany({ where: { enabled: true }, select: { id: true } })).map((c) => c.id) : [];
  return NextResponse.json({ managed, groups });
});
