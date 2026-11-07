import Link from "next/link";

/** أقسام كتالوج الأجهزة: الأنظمة وتعريفاتها، والماركات (قسم فرعي داخل الكتالوج) */
export default function CatalogTabs({ current }: { current: "systems" | "brands" }) {
  const tab = (key: typeof current, href: string, label: string) => (
    <Link href={href} aria-current={current === key ? "page" : undefined}
      className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors duration-200 ${current === key ? "border-brand font-semibold text-brand-strong" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-foreground"}`}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="أقسام كتالوج الأجهزة" className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tab("systems", "/catalog", "الأنظمة والأجهزة")}
      {tab("brands", "/catalog/brands", "الماركات")}
    </nav>
  );
}
