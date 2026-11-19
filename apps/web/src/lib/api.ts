import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, safeEqual, verifySessionToken } from "./auth";

/** Accepts either the dashboard session cookie or `Authorization: Bearer API_TOKEN`. */
export async function isAuthorized(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token && process.env.API_TOKEN && safeEqual(token, process.env.API_TOKEN)) return true;
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Wraps a route handler with auth + error handling. */
export function handler<T extends unknown[]>(fn: (req: Request, ...rest: T) => Promise<Response>) {
  return async (req: Request, ...rest: T) => {
    if (!(await isAuthorized(req))) return unauthorized();
    try {
      return await fn(req, ...rest);
    } catch (e) {
      console.error(e);
      return bad(e instanceof Error ? e.message : "Server error", 500);
    }
  };
}

/** For server actions / server components. */
export async function assertSession() {
  const jar = await cookies();
  if (!(await verifySessionToken(jar.get(SESSION_COOKIE)?.value))) throw new Error("Not signed in");
}
