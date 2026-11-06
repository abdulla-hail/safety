import Link from "next/link";
import type { ReactNode } from "react";

interface Crumb {
  label: string;
  href?: string;
}

export default function PageHeader({
  title,
  description,
  actions,
  crumbs,
  refNo,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
  refNo?: string | null;
}) {
  return (
    <header className="mb-6 space-y-2">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="مسار التنقل" className="text-xs text-slate-500">
          <ol className="flex flex-wrap items-center gap-1">
            {crumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                {c.href ? <Link href={c.href} className="transition-colors hover:text-brand-strong hover:underline">{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <span aria-hidden="true">‹</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-extrabold text-foreground">
            {title}
            {refNo && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm font-semibold text-slate-600" dir="ltr">
                {refNo}
              </span>
            )}
          </h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
