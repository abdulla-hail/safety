"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";

export interface NavItem {
  label: string;
  icon: IconName;
  href: string;
  section?: string;
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  tenantName: string;
  logoUrl: string | null;
  items: NavItem[];
}

export default function Sidebar({ open, onClose, tenantName, logoUrl, items }: SidebarProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const sections = [...new Set(items.map((i) => i.section ?? ""))];

  return (
    <>
      {open && <div className="overlay-enter fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] lg:hidden print:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        className={`fixed inset-y-0 start-0 z-40 flex w-64 flex-col bg-company text-white shadow-xl transition-[translate,visibility] duration-300 ease-[var(--ease-out)] lg:shadow-none print:hidden ${
          open ? "" : "max-lg:invisible max-lg:translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/15">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="size-full bg-white object-contain p-0.5" />
            ) : (
              <Icon name="shield" className="size-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold">{tenantName}</p>
            <p className="truncate text-xs text-white/70">عين السلامة</p>
          </div>
          <button type="button" onClick={onClose} className="icon-hover rounded-md p-1.5 text-white/80 transition hover:bg-white/10 lg:hidden" aria-label="إغلاق القائمة">
            <Icon name="x" />
          </button>
        </div>

        <nav aria-label="القائمة الرئيسية" className="flex-1 overflow-y-auto p-3">
          {sections.map((section) => (
            <div key={section || "main"} className="mb-3">
              {section && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-white/50">{section}</p>}
              <ul className="space-y-0.5">
                {items.filter((i) => (i.section ?? "") === section).map((item) => {
                  const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={active ? "page" : undefined}
                        className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-[background-color,color,padding] duration-200 ${
                          active ? "bg-white/15 font-bold" : "text-white/85 hover:bg-white/10 hover:ps-4"
                        }`}
                      >
                        {/* مؤشر العنصر النشط بلون المنصة */}
                        <span aria-hidden="true" className={`absolute inset-y-1.5 start-0 w-1 rounded-full bg-brand transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`} />
                        <span className={`transition-transform duration-200 group-hover:scale-110 ${active ? "text-brand" : ""}`}><Icon name={item.icon} /></span>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-5 py-3 text-[11px] text-white/60">منصة عين السلامة</div>
      </aside>
    </>
  );
}
