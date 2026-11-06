import Link from "next/link";
import type { ReactNode } from "react";
import { withParams, type SearchParams } from "@/lib/list";

export interface Column<T> {
  key: string;
  label: string;
  /** عمود قابل للفرز (اسم العمود في قاعدة البيانات) */
  sortKey?: string;
  className?: string;
  render: (row: T) => ReactNode;
}

export default function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty = "لا توجد سجلات مطابقة.",
  basePath,
  searchParams,
  sort,
  minWidth = 720,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: ReactNode;
  basePath?: string;
  searchParams?: SearchParams;
  sort?: { column: string; ascending: boolean };
  minWidth?: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="pop-enter flex flex-col items-center justify-center gap-2 px-6 py-14 text-center text-sm text-slate-500" role="status">
        <svg viewBox="0 0 24 24" className="size-10 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M3 7h18M3 12h18M3 17h10" strokeLinecap="round" />
        </svg>
        {empty}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm" style={{ minWidth }}>
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            {columns.map((c) => {
              const active = sort && c.sortKey === sort.column;
              const href =
                c.sortKey && basePath && searchParams
                  ? withParams(basePath, searchParams, {
                      sort: c.sortKey,
                      dir: active && !sort.ascending ? "asc" : "desc",
                      page: null,
                    })
                  : null;
              return (
                <th key={c.key} scope="col" className={`px-4 py-3 font-semibold ${c.className ?? ""}`}
                    aria-sort={active ? (sort.ascending ? "ascending" : "descending") : undefined}>
                  {href ? (
                    <Link href={href} className="inline-flex items-center gap-1 transition-colors hover:text-brand-strong">
                      {c.label}
                      <span aria-hidden="true" className={active ? "text-brand-icon" : "text-slate-300"}>
                        {active ? (sort.ascending ? "▲" : "▼") : "↕"}
                      </span>
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="rows-enter divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className="transition-colors duration-150 hover:bg-brand-soft/50">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 align-middle ${c.className ?? ""}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
