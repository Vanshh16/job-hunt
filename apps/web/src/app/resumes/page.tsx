import { prisma } from "@/lib/db";
import { RescoreAll, ResumeRow, ResumeUpload } from "@/components/Forms";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ResumesPage() {
  const resumes = await prisma.resume.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, label: true, fileName: true, isDefault: true, text: true, createdAt: true } });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Resumes</h1>
        <p className="muted">Keep 2–3 focused versions (e.g. Frontend, Backend, Analytics). For every job the AI scores each one, recommends the best, and tells you what to edit when none fit well. The extension attaches the recommended file automatically.</p>
      </div>
      {resumes.length ? (
        <ul className="card divide-y divide-gray-100 p-0!">
          {resumes.map((r) => (
            <ResumeRow key={r.id} r={{ id: r.id, label: r.label, fileName: r.fileName, isDefault: r.isDefault, chars: r.text.length, createdAt: r.createdAt.toISOString() }} />
          ))}
        </ul>
      ) : (
        <Empty>No resumes yet.</Empty>
      )}
      <ResumeUpload />
      {resumes.length > 0 && <RescoreAll />}
    </div>
  );
}
