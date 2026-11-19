import { handler, bad } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const r = await prisma.resume.findUnique({ where: { id } });
  if (!r) return bad("Not found", 404);
  return new Response(new Uint8Array(r.data), {
    headers: {
      "content-type": r.mimeType,
      "content-disposition": `inline; filename="${encodeURIComponent(r.fileName)}"`,
      "x-file-name": encodeURIComponent(r.fileName),
      "cache-control": "private, no-store",
    },
  });
});
