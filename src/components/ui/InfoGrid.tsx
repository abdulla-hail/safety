import type { ReactNode } from "react";

export default function InfoGrid({ items, cols = 3 }: { items: [string, ReactNode][]; cols?: 2 | 3 | 4 }) {
  const grid = cols === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-4 p-5 ${grid}`}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold text-slate-500">{k}</dt>
          <dd className="mt-1 break-words text-sm text-foreground">{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}
