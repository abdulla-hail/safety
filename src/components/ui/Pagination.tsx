import Link from "next/link";
import { PAGE_SIZE, withParams, type SearchParams } from "@/lib/list";

export default function Pagination({
  basePath,
  searchParams,
  page,
  total,
  pageSize = PAGE_SIZE,
}: {
  basePath: string;
  searchParams: SearchParams;
  page: number;
  total: number;
  pageSize?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkCls = "rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,color,transform] duration-200 hover:border-brand hover:bg-brand-soft hover:text-brand-strong active:scale-[0.97]";
  return (
    <nav aria-label="ترقيم الصفحات" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
      <span>
        عرض {from}–{to} من أصل {total}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={linkCls} href={withParams(basePath, searchParams, { page: page - 1 })}>السابق</Link>
        ) : (
          <span className={`${linkCls} opacity-40`} aria-disabled="true">السابق</span>
        )}
        <span>
          صفحة {Math.min(page, pages)} من {pages}
        </span>
        {page < pages ? (
          <Link className={linkCls} href={withParams(basePath, searchParams, { page: page + 1 })}>التالي</Link>
        ) : (
          <span className={`${linkCls} opacity-40`} aria-disabled="true">التالي</span>
        )}
      </div>
    </nav>
  );
}
