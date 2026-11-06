import Form from "next/form";
import Link from "next/link";
import MultiSelectForm from "@/components/ui/MultiSelectForm";
import ActionButton from "@/components/ui/ActionButton";
import { btnSecondary, btnSm, card, cardHeader, cardTitle, input, link } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/server";
import { cleanSearch, orIlike } from "@/lib/list";
import { assignCustomersToTechnician } from "./actions";
import { unassign } from "../customers/actions";

/** لوحة إسناد العملاء لفني: الإسنادات الحالية + بحث وتحديد عملاء متعددين. */
export default async function AssignmentPanel({
  technicianId, orgId, search, formAction, hidden = {}, canAssign,
}: {
  technicianId: string;
  orgId: string;
  search: string;
  formAction: string;
  hidden?: Record<string, string>;
  canAssign: boolean;
}) {
  const supabase = await createClient();
  const { data: rows } = await supabase.from("technician_customers")
    .select("customer:customers(id, ref_no, name, city)").eq("technician_id", technicianId).order("created_at");
  type C = { id: string; ref_no: string; name: string; city: string | null };
  const assigned = ((rows ?? []) as unknown as { customer: C | null }[]).map((r) => r.customer).filter((c): c is C => !!c);
  const assignedIds = new Set(assigned.map((c) => c.id));

  let candidates: C[] = [];
  if (canAssign) {
    let q = supabase.from("customers").select("id, ref_no, name, city").eq("company_id", orgId).is("archived_at", null).order("name").limit(150);
    const s = orIlike(["name", "ref_no", "city"], search);
    if (s) q = q.or(s);
    candidates = ((await q).data ?? []).filter((c) => !assignedIds.has(c.id)) as C[];
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>العملاء المسندون ({assigned.length})</h2></div>
        <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
          {assigned.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <Link href={`/customers/${c.id}`} className={link}>{c.name}</Link>
                <p className="text-xs text-slate-500"><span dir="ltr">{c.ref_no}</span> {c.city ? `· ${c.city}` : ""}</p>
              </div>
              {canAssign && (
                <ActionButton action={unassign} hidden={{ technician_id: technicianId, customer_id: c.id }} label="إزالة"
                  confirm={`إزالة العميل «${c.name}» من هذا الفني؟ لن يُحذف العميل.`} className={`${btnSecondary} ${btnSm}`} />
              )}
            </li>
          ))}
          {assigned.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا يوجد عملاء مسندون لهذا الفني.</li>}
        </ul>
      </section>
      {canAssign && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>إسناد عملاء جدد</h2></div>
          <div className="space-y-4 p-5">
            <Form action={formAction} className="flex gap-2">
              {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <input type="search" name="cq" defaultValue={search} placeholder="ابحث عن عميل بالاسم أو الرقم أو المدينة..." className={input} aria-label="بحث عن العملاء" />
              <button type="submit" className={btnSecondary}>بحث</button>
            </Form>
            <p className="text-xs text-slate-500">
              {cleanSearch(search) ? `نتائج البحث عن «${cleanSearch(search)}»` : "أول 150 عميلًا غير مسند"} — حدّد العملاء ثم احفظ دفعة واحدة.
            </p>
            <MultiSelectForm action={assignCustomersToTechnician} name="customer_ids" hidden={{ technician_id: technicianId }}
              options={candidates.map((c) => ({ value: c.id, label: c.name, hint: c.ref_no }))}
              submitLabel="إسناد المحددين" emptyText="لا يوجد عملاء غير مسندين مطابقون للبحث." />
          </div>
        </section>
      )}
    </div>
  );
}
