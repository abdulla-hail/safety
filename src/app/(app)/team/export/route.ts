import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { companyMemberStatus, companyRole } from "@/lib/labels";
import { loadTeam, memberSpecialties } from "@/lib/team";
import type { SearchParams } from "@/lib/list";

const cell = (v: unknown) => {
  const s = String(v ?? "");
  // منع حقن الصيغ في برامج الجداول، وتهريب الفواصل وعلامات التنصيص
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** تصدير الفريق CSV (UTF-8 مع BOM ليفتح بالعربية في Excel)؛ لمدير الشركة فقط وبالفلاتر نفسها. */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx?.active?.is_owner) return new NextResponse("غير مصرح", { status: 403 });
  const sp: SearchParams = {};
  for (const k of new Set(req.nextUrl.searchParams.keys())) sp[k] = req.nextUrl.searchParams.getAll(k);
  const supabase = await createClient();
  const { rows, error } = await loadTeam(supabase, ctx.active.organization_id, sp);
  if (error) return new NextResponse("تعذر تحميل البيانات", { status: 500 });
  const header = ["الاسم", "البريد", "الدور", "المدير الأساسي", "المسمى", "التخصصات", "الجوال", "رقم الفني", "الحالة", "صلاحيات مخصصة", "تاريخ الانضمام"];
  const lines = rows.map((m) => [m.full_name, m.email, companyRole[m.role] ?? m.role, m.is_primary ? "نعم" : "", m.job_title, memberSpecialties(m).join("، "),
    m.technician?.phone, m.technician?.ref_no, companyMemberStatus[m.status]?.label ?? m.status, m.permissions ? "نعم" : "", m.created_at.slice(0, 10)].map(cell).join(","));
  const body = "﻿" + [header.join(","), ...lines].join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="team-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
