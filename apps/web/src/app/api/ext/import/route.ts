import { NextResponse } from "next/server";
import { bad, handler } from "@/lib/api";
import { ingestText } from "@/lib/jobs";

export const maxDuration = 60;

/** Extension: import jobs from selected text (e.g. a LinkedIn "we're hiring" post). */
export const POST = handler(async (req) => {
  const { text, url } = (await req.json()) as { text?: string; url?: string };
  if (!text || text.trim().length < 40) return bad("Select more text");
  const results = await ingestText(url ? `${text}\n\nSource: ${url}` : text, "extension", url, { notify: false });
  return NextResponse.json({ jobs: results.map((r) => ({ id: r.job.id, title: r.job.title, company: r.job.company, score: r.score, created: r.created })) });
});
