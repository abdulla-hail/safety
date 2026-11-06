"use client";

import Link from "next/link";
import Form from "next/form";
import Icon from "@/components/ui/Icon";
import { switchOrganization } from "@/app/(app)/actions";

interface OrgOption {
  id: string;
  name: string;
}

interface TopbarProps {
  tenantName: string;
  userName: string;
  roleName: string;
  avatarUrl: string | null;
  unreadCount: number;
  orgs: OrgOption[];
  activeOrgId: string | null;
  canSearch: boolean;
  onMenuClick: () => void;
}

export default function Topbar({
  tenantName, userName, roleName, avatarUrl, unreadCount, orgs, activeOrgId, canSearch, onMenuClick,
}: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-card px-4 sm:px-6 print:hidden">
      <button type="button" onClick={onMenuClick} className="icon-hover rounded-md p-2 text-slate-600 transition hover:bg-brand-soft hover:text-brand-strong lg:hidden" aria-label="فتح القائمة">
        <Icon name="menu" className="size-6" />
      </button>

      {canSearch && (
        <Form action="/devices" className="relative hidden w-full max-w-sm sm:block" role="search">
          <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" className="size-4" />
          </span>
          <input type="search" name="q" placeholder="ابحث عن جهاز بالاسم أو الرقم أو التسلسلي..." aria-label="بحث في الأجهزة"
                 className="w-full rounded-lg border border-slate-200 bg-background py-2 pe-3 ps-10 text-sm outline-none transition-[border-color,box-shadow] duration-200 focus:border-brand focus:ring-2 focus:ring-[var(--brand-ring)]" />
        </Form>
      )}

      <div className="ms-auto flex items-center gap-2 sm:gap-3">
        {orgs.length > 1 && (
          <form action={switchOrganization} className="hidden md:block">
            <label htmlFor="org-switch" className="sr-only">الشركة</label>
            <select id="org-switch" name="org" defaultValue={activeOrgId ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs transition focus:border-brand">
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </form>
        )}

        <Link href="/scan" className="icon-hover rounded-full p-2 text-slate-600 transition hover:bg-brand-soft hover:text-brand-strong" aria-label="مسح رمز جهاز" title="مسح رمز جهاز">
          <Icon name="scan" className="size-5" />
        </Link>

        <Link href="/notifications" className="icon-hover relative rounded-full p-2 text-slate-600 transition hover:bg-brand-soft hover:text-brand-strong"
              aria-label={unreadCount > 0 ? `الإشعارات (${unreadCount} غير مقروءة)` : "الإشعارات"}>
          <Icon name="bell" className="size-5" />
          {unreadCount > 0 && (
            <span className="pop-enter absolute -end-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>

        <div className="flex items-center gap-3 border-s border-slate-200 ps-3">
          <div className="hidden text-start sm:block">
            <p className="text-sm font-bold leading-tight text-foreground">{userName}</p>
            <p className="text-xs text-slate-500">{roleName} · {tenantName}</p>
          </div>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-9 rounded-full object-cover" />
          ) : (
            <div className="flex size-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-on-brand" aria-hidden="true">
              {userName.charAt(0)}
            </div>
          )}
        </div>

        <form action="/auth/signout" method="post">
          <button type="submit" className="icon-hover inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand hover:bg-brand-soft hover:text-brand-strong active:scale-[0.97]" aria-label="تسجيل الخروج">
            <Icon name="logOut" className="size-4" />
            <span className="hidden sm:inline">خروج</span>
          </button>
        </form>
      </div>
    </header>
  );
}
