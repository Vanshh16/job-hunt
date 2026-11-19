import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getProfile, fullNameOf } from "@/lib/profile";

export const GET = handler(async () => {
  const [{ fields }, resumes] = await Promise.all([
    getProfile(),
    prisma.resume.findMany({ select: { id: true, label: true, fileName: true, isDefault: true }, orderBy: { createdAt: "asc" } }),
  ]);
  return NextResponse.json({ ok: true, name: fullNameOf(fields), resumes });
});
