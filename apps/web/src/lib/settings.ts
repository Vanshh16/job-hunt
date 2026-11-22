import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: Prisma.InputJsonValue) {
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
