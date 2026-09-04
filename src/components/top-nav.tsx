"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Backtest range" },
  { href: "/gap", label: "Gap di apertura" },
  { href: "/swing", label: "Fasi di massimi e minimi" },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-[var(--line)] bg-[var(--panel)]">
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-4 px-4">
        <span className="py-2.5 text-[12px] font-medium tracking-tight">S&amp;P Analytics</span>
        <div className="flex">
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                data-on={active}
                className="border-b-2 border-transparent px-3 py-2.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] data-[on=true]:border-[var(--accent)] data-[on=true]:text-[var(--text)]"
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
