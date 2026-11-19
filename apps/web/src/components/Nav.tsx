"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "◧" },
  { href: "/jobs", label: "Jobs inbox", icon: "✦" },
  { href: "/tracker", label: "Tracker", icon: "▤" },
  { href: "/import", label: "Import / add", icon: "＋" },
  { href: "/resumes", label: "Resumes", icon: "▭" },
  { href: "/profile", label: "Profile & prefs", icon: "☺" },
  { href: "/answers", label: "Answer bank", icon: "❝" },
  { href: "/settings", label: "Setup", icon: "⚙" },
];

export function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav className="sticky top-0 z-10 flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2 md:h-screen md:w-56 md:flex-col md:border-r md:border-b-0 md:px-3 md:py-5">
      <div className="hidden px-3 pb-5 md:block">
        <div className="text-lg font-bold tracking-tight text-brand-700">Job Hunt</div>
        <div className="text-xs text-gray-400">your application copilot</div>
      </div>
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap ${active ? "bg-brand-50 font-medium text-brand-700" : "text-gray-600 hover:bg-gray-50"}`}
          >
            <span className="w-4 text-center opacity-70">{l.icon}</span>
            {l.label}
          </Link>
        );
      })}
      <form action={logout} className="md:mt-auto">
        <button className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap text-gray-500 hover:bg-gray-50">
          <span className="w-4 text-center opacity-70">⎋</span>Sign out
        </button>
      </form>
    </nav>
  );
}
