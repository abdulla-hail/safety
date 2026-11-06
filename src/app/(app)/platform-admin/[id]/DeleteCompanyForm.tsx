"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnDanger, input, label } from "@/components/ui/styles";
import { deleteCompany } from "../actions";

/** حذف نهائي محمي: يتطلب أرشفة مسبقة وكتابة رقم الشركة، وترفضه قاعدة البيانات عند وجود أي سجل تشغيلي. */
export default function DeleteCompanyForm({ id, refNo }: { id: string; refNo: string | null }) {
  const [state, action, pending] = useActionState(deleteCompany, initialActionState);
  return (
    <form action={action} className="space-y-3"
      onSubmit={(e) => { if (!window.confirm("حذف الشركة نهائيًا؟ لا يمكن التراجع.")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <div>
        <label htmlFor="confirm_ref" className={label}>للتأكيد اكتب رقم الشركة {refNo && <b dir="ltr">{refNo}</b>}</label>
        <input id="confirm_ref" name="confirm_ref" dir="ltr" required autoComplete="off" className={`${input} max-w-xs font-mono`} />
      </div>
      {state.message && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
      <button aria-busy={pending} type="submit" disabled={pending} className={btnDanger}>{pending ? "جارٍ الحذف..." : "حذف نهائي"}</button>
    </form>
  );
}
