"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { JobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertSession } from "@/lib/api";
import { SESSION_COOKIE, createSessionToken, safeEqual, sessionCookieOptions } from "@/lib/auth";
import { DEFAULT_PREFS, PROFILE_FIELDS, getProfile, type Preferences } from "@/lib/profile";
import { ingestText, logActivity, scoreJob, setStatus, upsertExtractedJob } from "@/lib/jobs";
import { writeCoverLetter, writeOutreach, type OutreachKind } from "@/lib/ai";
import { detectChats, notify, telegramConfigured } from "@/lib/telegram";
import { norm } from "@/lib/fieldmap";

// ---------- Auth ----------

export async function login(_: unknown, form: FormData) {
  const password = String(form.get("password") ?? "");
  if (!process.env.APP_PASSWORD || !safeEqual(password, process.env.APP_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 800));
    return { error: "Wrong password" };
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  const next = String(form.get("next") || "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- Profile ----------

export async function saveProfile(_: unknown, form: FormData) {
  await assertSession();
  const fields: Record<string, string> = {};
  for (const def of PROFILE_FIELDS) {
    const v = String(form.get(def.key) ?? "").trim();
    if (v) fields[def.key] = v;
  }
  // Custom extra fields: "extra_key[]" / "extra_value[]"
  const keys = form.getAll("extra_key").map(String);
  const vals = form.getAll("extra_value").map(String);
  keys.forEach((k, i) => {
    if (k.trim() && vals[i]?.trim()) fields[k.trim()] = vals[i].trim();
  });
  await prisma.profile.upsert({ where: { id: 1 }, update: { fields }, create: { id: 1, fields } });
  revalidatePath("/profile");
  return { ok: true, at: Date.now() };
}

export async function savePreferences(_: unknown, form: FormData) {
  await assertSession();
  const p: Preferences = {
    targetRoles: String(form.get("targetRoles") ?? DEFAULT_PREFS.targetRoles),
    locations: String(form.get("locations") ?? ""),
    experienceLevel: String(form.get("experienceLevel") ?? ""),
    mustHaveKeywords: String(form.get("mustHaveKeywords") ?? ""),
    excludeKeywords: String(form.get("excludeKeywords") ?? ""),
    minScoreToNotify: Number(form.get("minScoreToNotify") ?? 60) || 60,
    followUpDays: Number(form.get("followUpDays") ?? 7) || 7,
  };
  await prisma.profile.upsert({ where: { id: 1 }, update: { preferences: p }, create: { id: 1, preferences: p } });
  revalidatePath("/profile");
  return { ok: true, at: Date.now() };
}

// ---------- Resumes ----------

async function extractResumeText(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    // pdf.js takes ownership of (detaches) the buffer it's given — pass a copy so `buf` keeps the file bytes.
    const pdf = await getDocumentProxy(buf.slice());
    const { text } = await extractText(pdf, { mergePages: true });
    return { buf, text: String(text) };
  }
  return { buf, text: new TextDecoder().decode(buf) };
}

export async function uploadResume(_: unknown, form: FormData) {
  await assertSession();
  const file = form.get("file");
  const label = String(form.get("label") ?? "").trim();
  if (!(file instanceof File) || !file.size) return { error: "Choose a PDF file" };
  if (file.size > 4 * 1024 * 1024) return { error: "File too large (max 4 MB)" };
  const { buf, text } = await extractResumeText(file);
  if (buf.byteLength !== file.size) return { error: "Upload failed while reading the file — please try again." };
  if (text.trim().length < 100) return { error: "Couldn't read text from this file. Use a text-based PDF (not a scanned image)." };
  const count = await prisma.resume.count();
  await prisma.resume.create({
    data: {
      label: label || file.name.replace(/\.[^.]+$/, ""),
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      data: Buffer.from(buf),
      text,
      isDefault: count === 0,
    },
  });
  revalidatePath("/resumes");
  return { ok: true, at: Date.now() };
}

export async function deleteResume(id: string) {
  await assertSession();
  await prisma.resume.delete({ where: { id } });
  revalidatePath("/resumes");
}

export async function setDefaultResume(id: string) {
  await assertSession();
  await prisma.$transaction([prisma.resume.updateMany({ data: { isDefault: false } }), prisma.resume.update({ where: { id }, data: { isDefault: true } })]);
  revalidatePath("/resumes");
}

export async function renameResume(id: string, label: string) {
  await assertSession();
  await prisma.resume.update({ where: { id }, data: { label } });
  revalidatePath("/resumes");
}

// ---------- Jobs ----------

export async function updateJobStatus(id: string, status: JobStatus) {
  await assertSession();
  await setStatus(id, status);
  revalidatePath("/", "layout");
}

export async function updateJob(id: string, data: { notes?: string; followUpAt?: string | null; url?: string; deadline?: string | null }) {
  await assertSession();
  const patch: Prisma.JobUpdateInput = {};
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.url !== undefined) patch.url = data.url || null;
  if (data.followUpAt !== undefined) patch.followUpAt = data.followUpAt ? new Date(data.followUpAt) : null;
  if (data.deadline !== undefined) patch.deadline = data.deadline ? new Date(data.deadline) : null;
  await prisma.job.update({ where: { id }, data: patch });
  revalidatePath(`/jobs/${id}`);
}

export async function deleteJob(id: string) {
  await assertSession();
  await prisma.job.delete({ where: { id } });
  revalidatePath("/", "layout");
  redirect("/jobs");
}

export async function rescoreJob(id: string) {
  await assertSession();
  await scoreJob(id);
  revalidatePath(`/jobs/${id}`);
}

export async function rescoreOpenJobs() {
  await assertSession();
  const jobs = await prisma.job.findMany({ where: { status: { in: ["NEW", "SAVED"] } }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true } });
  let n = 0;
  for (const j of jobs) {
    try {
      await scoreJob(j.id);
      n++;
    } catch (e) {
      console.error(e);
    }
  }
  revalidatePath("/", "layout");
  return { rescored: n };
}

export async function generateForJob(id: string, kind: "cover" | OutreachKind, extra?: string) {
  await assertSession();
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) throw new Error("Job not found");
  const { fields } = await getProfile();
  const resume = job.bestResumeId ? await prisma.resume.findUnique({ where: { id: job.bestResumeId } }) : await prisma.resume.findFirst();
  const text =
    kind === "cover" ? await writeCoverLetter(job, resume?.text ?? "", fields, extra) : await writeOutreach(kind, job, resume?.text ?? "", fields, extra);
  if (kind === "cover") await prisma.job.update({ where: { id }, data: { coverLetter: text } });
  await logActivity(id, "generate", `Generated ${kind === "cover" ? "cover letter" : `${kind} message`}`);
  return text;
}

export async function importText(_: unknown, form: FormData) {
  await assertSession();
  const text = String(form.get("text") ?? "").trim();
  if (text.length < 40) return { error: "Paste a job post (at least a few lines)." };
  try {
    const results = await ingestText(text, "manual", undefined, { notify: false });
    revalidatePath("/", "layout");
    return {
      ok: true,
      at: Date.now(),
      results: results.map((r) => ({ id: r.job.id, title: r.job.title, company: r.job.company, created: r.created, score: r.score })),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Import failed" };
  }
}

export async function addManualJob(_: unknown, form: FormData) {
  await assertSession();
  const title = String(form.get("title") ?? "").trim();
  const company = String(form.get("company") ?? "").trim();
  if (!title || !company) return { error: "Title and company are required" };
  const [job, created] = await upsertExtractedJob(
    {
      title,
      company,
      url: String(form.get("url") ?? "").trim() || undefined,
      location: String(form.get("location") ?? "").trim() || undefined,
      description: String(form.get("description") ?? "").trim() || undefined,
    },
    "manual",
  );
  if (created && job.description) await scoreJob(job.id).catch(console.error);
  redirect(`/jobs/${job.id}`);
}

// ---------- Answer bank ----------

export async function saveAnswer(_: unknown, form: FormData) {
  await assertSession();
  const id = String(form.get("id") ?? "");
  const question = String(form.get("question") ?? "").trim();
  const answer = String(form.get("answer") ?? "").trim();
  if (!question || !answer) return { error: "Question and answer required" };
  if (id) await prisma.answer.update({ where: { id }, data: { question, answer } });
  else {
    const dupe = (await prisma.answer.findMany({ select: { id: true, question: true } })).find((a) => norm(a.question) === norm(question));
    if (dupe) await prisma.answer.update({ where: { id: dupe.id }, data: { answer } });
    else await prisma.answer.create({ data: { question, answer } });
  }
  revalidatePath("/answers");
  return { ok: true, at: Date.now() };
}

export async function deleteAnswer(id: string) {
  await assertSession();
  await prisma.answer.delete({ where: { id } });
  revalidatePath("/answers");
}

// ---------- Telegram ----------

export async function testTelegram() {
  await assertSession();
  if (!telegramConfigured()) return { error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first." };
  const ok = await notify("✅ Job Hunt notifications are working.");
  return ok ? { ok: true } : { error: "Telegram rejected the message. Check the token and chat id." };
}

export async function findTelegramChats() {
  await assertSession();
  try {
    return { chats: await detectChats() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed", chats: [] };
  }
}
