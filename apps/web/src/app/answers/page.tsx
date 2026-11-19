import { prisma } from "@/lib/db";
import { AnswerForm } from "@/components/Forms";

export const dynamic = "force-dynamic";

const STARTERS = [
  "Why do you want to join our company?",
  "Tell us about yourself",
  "Describe a challenging project you worked on",
  "What are your strengths?",
  "Are you willing to work from office 5 days a week?",
  "Are you comfortable with a service agreement / bond?",
];

export default async function AnswersPage() {
  const answers = await prisma.answer.findMany({ orderBy: [{ uses: "desc" }, { updatedAt: "desc" }] });
  const have = new Set(answers.map((a) => a.question.toLowerCase()));
  const missing = STARTERS.filter((s) => !have.has(s.toLowerCase()));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Answer bank</h1>
        <p className="muted">
          Reusable answers to screening questions. The extension fills a field from here when the question closely matches, and the AI uses these as reference for new questions.
          Save answers you liked straight from the extension with &ldquo;Save answers to bank&rdquo;.
        </p>
      </div>
      {missing.length > 0 && (
        <div className="text-sm text-gray-500">Common ones worth writing: {missing.map((m) => <span key={m} className="mr-1 mb-1 inline-block rounded bg-white px-2 py-0.5 ring-1 ring-gray-200">{m}</span>)}</div>
      )}
      <AnswerForm />
      <div className="space-y-3">
        {answers.map((a) => <AnswerForm key={a.id} a={a} />)}
      </div>
    </div>
  );
}
