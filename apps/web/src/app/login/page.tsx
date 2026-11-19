"use client";

import { useActionState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { login } from "../actions";

function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  const next = useSearchParams().get("next") ?? "/";
  return (
    <form action={action} className="card mx-auto mt-24 w-full max-w-sm space-y-4">
      <div>
        <div className="text-xl font-bold text-brand-700">Job Hunt</div>
        <p className="muted">Sign in to your copilot</p>
      </div>
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="input" autoFocus required />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
