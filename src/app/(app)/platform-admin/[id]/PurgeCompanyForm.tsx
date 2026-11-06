"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnDanger, input, label } from "@/components/ui/styles";
import { purgeCompany } from "../actions";

/**
 * الحذف الكامل: الزر لا يُفعَّل إلا بعد كتابة اسم الشركة كما هو، ثم تأكيد ثانٍ؛ القاعدة تعيد التحقق من الاسم
 * ومن صفة مالك المنصة وتنفذ الحذف في معاملة واحدة.
 */
export default function PurgeCompanyForm({ id, name, totalRows, files, removableAccounts }: {
  id: string; name: string; totalRows: number; files: number; removableAccounts: number;
}) {
  const [state, action, pending] = useActionState(purgeCompany, initialActionState);
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === name.trim();
  return (
    <form action={action} className="space-y-3"
      onSubmit={(e) => {
        if (!window.confirm(`سيُحذف «${name}» نهائيًا مع ${totalRows} سجلًا و${files} ملفًا. لا يمكن التراجع. متابعة؟`)) e.preventDefault();
      }}>
      <input type="hidden" name="id" value={id} />
      {removableAccounts > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="delete_accounts" className="mt-1" />
          <span>احذف أيضًا حسابات الدخول الخاصة بهذه الشركة فقط ({removableAccounts})، أي من لا ينتمي لشركة أخرى ولا يملك صفة في المنصة.
            بدون هذا الخيار تبقى الحسابات بلا عضوية ويمكن دعوتها لاحقًا.</span>
        </label>
      )}
      <div>
        <label htmlFor="confirm_name" className={label}>للتأكيد اكتب اسم الشركة كما هو: <b>{name}</b></label>
        <input id="confirm_name" name="confirm_name" required autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)}
          className={`${input} max-w-md`} aria-invalid={typed !== "" && !matches} />
      </div>
      {state.message && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
      <button aria-busy={pending} type="submit" disabled={pending || !matches} className={btnDanger}>
        {pending ? "جارٍ الحذف الكامل..." : "حذف الشركة وكل بياناتها نهائيًا"}
      </button>
    </form>
  );
}
