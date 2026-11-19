import { PROFILE_FIELDS, getProfile } from "@/lib/profile";
import { PreferencesForm, ProfileForm } from "@/components/Forms";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { fields, preferences } = await getProfile();
  // RegExps can't cross the server/client boundary.
  const defs = PROFILE_FIELDS.map(({ patterns: _p, ...d }) => d);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Profile & preferences</h1>
        <p className="muted">Fill this once — the extension uses it to autofill every application form, and the AI uses it to answer screening questions.</p>
      </div>
      <PreferencesForm prefs={preferences} />
      <ProfileForm defs={defs} values={fields} />
    </div>
  );
}
