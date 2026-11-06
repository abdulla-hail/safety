"use client";

import LinesEditor, { type Line } from "./LinesEditor";
import { deleteSurveyItem, saveSurveyItem } from "@/app/(app)/visits/survey-actions";
import { deleteQuoteItem, saveQuoteItem } from "@/app/(app)/quotes/actions";
import { surveyIssue } from "@/lib/labels";

/** بنود المعاينة: الجهاز/النظام، نوع المشكلة، الوصف، الكمية وسعر الوحدة */
export function SurveyItems({ visitId, lines, devices, vatRate, locked, brands = [], canAddBrand = false }: {
  visitId: string; lines: Line[]; devices: { value: string; label: string }[]; vatRate: number; locked: boolean; brands?: string[]; canAddBrand?: boolean;
}) {
  const devName = new Map(devices.map((d) => [d.value, d.label]));
  return (
    <LinesEditor lines={lines} vatRate={vatRate} locked={locked} addLabel="+ إضافة جهاز / بند"
      emptyText={locked ? "لا توجد بنود." : "لم تُسجَّل بنود بعد. أضف كل جهاز أو نظام يحتاج صيانة مع تكلفته التقديرية."}
      fields={[
        ...(devices.length ? [{ name: "device_id", label: "جهاز مسجل في الفرع (اختياري)", type: "select" as const, options: devices }] : []),
        { name: "title", label: "الجهاز / النظام / العمل", required: true, placeholder: "مثال: مضخة الحريق الرئيسية" },
        { name: "brand", label: canAddBrand ? "الماركة (اختر أو اكتب جديدة)" : "الماركة (من القائمة)", type: "combo", options: brands.map((b) => ({ value: b, label: b })) },
        { name: "issue_type", label: "نوع المشكلة", type: "select", required: true, options: Object.entries(surveyIssue).map(([value, label]) => ({ value, label })) },
        { name: "quantity", label: "الكمية", type: "number", required: true },
        { name: "unit_price", label: "سعر الوحدة (ر.س)", type: "number", required: true, placeholder: "0" },
        { name: "description", label: "وصف المشكلة والعمل المقترح", type: "textarea" },
      ]}
      onSave={(id, fields) => saveSurveyItem({ visitId, id, fields })}
      onDelete={(id) => deleteSurveyItem({ visitId, id })}
      render={(l) => (
        <div className="space-y-0.5">
          <p className="font-semibold">{String(l.title)}{l.brand ? <span className="ms-1 text-xs font-normal text-slate-600">· {String(l.brand)}</span> : null}</p>
          <p className="text-xs"><span className="rounded bg-amber-50 px-1.5 text-amber-800">{surveyIssue[String(l.issue_type)] ?? String(l.issue_type)}</span>
            {l.device_id && devName.get(String(l.device_id)) ? <span className="ms-1 text-slate-500">· جهاز مسجل</span> : null}</p>
          {l.description && <p className="whitespace-pre-line text-xs text-slate-600">{String(l.description)}</p>}
        </div>
      )} />
  );
}

/** بنود عرض السعر: الوصف والكمية وسعر الوحدة (قابلة للتعديل ما دام العرض «قيد الإعداد») */
export function QuoteItems({ quoteId, lines, vatRate, locked, brands = [], canAddBrand = false }: { quoteId: string; lines: Line[]; vatRate: number; locked: boolean; brands?: string[]; canAddBrand?: boolean }) {
  return (
    <LinesEditor lines={lines} vatRate={vatRate} locked={locked}
      emptyText={locked ? "لا توجد بنود." : "لا توجد بنود بعد. أضف الأعمال والمواد بأسعارها."}
      fields={[
        { name: "description", label: "الجهاز / الخدمة ووصف البند", type: "textarea", required: true },
        { name: "brand", label: canAddBrand ? "الماركة (اختر أو اكتب جديدة)" : "الماركة (من القائمة)", type: "combo", options: brands.map((b) => ({ value: b, label: b })) },
        { name: "quantity", label: "الكمية", type: "number", required: true },
        { name: "unit_price", label: "سعر الوحدة (ر.س)", type: "number", required: true, placeholder: "0" },
      ]}
      onSave={(id, fields) => saveQuoteItem({ quoteId, id, fields })}
      onDelete={(id) => deleteQuoteItem({ quoteId, id })}
      render={(l) => <div><p className="whitespace-pre-line">{String(l.description)}</p>{l.brand ? <p className="text-xs text-slate-600">الماركة: {String(l.brand)}</p> : null}</div>} />
  );
}
