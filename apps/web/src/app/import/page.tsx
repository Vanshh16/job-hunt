import { ImportForm, ManualJobForm } from "@/components/Forms";

export default function ImportPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Import / add jobs</h1>
        <p className="muted">The Telegram group syncs automatically; use this for anything else you come across.</p>
      </div>
      <ImportForm />
      <ManualJobForm />
    </div>
  );
}
