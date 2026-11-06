import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { canRunReport, fetchAll, getReport } from "@/lib/reports";
import type { SearchParams } from "@/lib/list";

function csvCell(v: string | number | null) {
  let s = v === null || v === undefined ? "" : String(v);
  // منع حقن الصيغ في برامج الجداول
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** تصدير التقرير CSV (UTF-8 مع BOM ليظهر النص العربي صحيحًا في Excel). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getContext();
  const report = getReport(slug);
  if (!ctx) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  if (!report || !canRunReport(report, ctx.permissions, ctx.platformPermissions.has("platform.companies.view")) || (!report.platformOnly && !ctx.permissions.has("reports.export"))) {
    return new NextResponse("غير مصرح", { status: 403 });
  }
  const orgId = ctx.active?.organization_id ?? "";
  const sp: SearchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const supabase = await createClient();
  const { rows, error, truncated } = await fetchAll(report, { sb: supabase, orgId, sp }, 10000);
  if (error) return new NextResponse("تعذر إنشاء التقرير", { status: 500 });

  const lines = [report.columns.map((c) => csvCell(c.label)).join(",")];
  for (const r of rows) lines.push(report.columns.map((c) => csvCell(c.value(r))).join(","));
  if (truncated) lines.push(csvCell("تم الاقتصار على أول 10000 صف — ضيّق معايير التصفية"));
  const body = `﻿${lines.join("\r\n")}`;
  const name = `${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
