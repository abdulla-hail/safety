import type { ReactNode } from "react";
import PageHeader from "@/components/ui/PageHeader";

/** ميزة تتطلب ترحيلًا لم يُعتمد بعد: رسالة واضحة بدل خطأ أو قائمة فارغة مضللة */
export default function PhasePending({ title = "البلاغات والأعطال", children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        {children ?? "هذه الميزة جاهزة في التطبيق لكنها تتطلب تفعيل تحديث قاعدة البيانات الخاص بالبلاغات وسجل الزيارات (المرحلة الخامسة)، ولم يُعتمد بعد. لم يُحفظ أو يُفقد أي شيء."}
      </p>
    </div>
  );
}
