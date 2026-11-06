import Form from "next/form";
import Link from "next/link";
import { btnSecondary, card, input, link } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/server";
import { orIlike } from "@/lib/list";

/** اختيار عميل بالبحث في قاعدة البيانات (دون تحميل جميع العملاء للمتصفح). */
export default async function CustomerPicker({ orgId, basePath, search }: { orgId: string; basePath: string; search: string }) {
  const supabase = await createClient();
  let q = supabase.from("customers").select("id, ref_no, name, city").eq("company_id", orgId).is("archived_at", null).order("name").limit(30);
  const s = orIlike(["name", "ref_no", "city"], search);
  if (s) q = q.or(s);
  const { data } = await q;
  const sep = basePath.includes("?") ? "&" : "?";
  return (
    <section className={`${card} p-5`}>
      <Form action={basePath.split("?")[0]} className="mb-4 flex gap-2">
        {[...new URLSearchParams(basePath.split("?")[1] ?? "")].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input name="q" type="search" defaultValue={search} placeholder="ابحث عن العميل بالاسم أو الرقم..." className={input} aria-label="بحث عن العميل" />
        <button type="submit" className={btnSecondary}>بحث</button>
      </Form>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {(data ?? []).map((c) => (
          <li key={c.id}>
            <Link href={`${basePath}${sep}customer=${c.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50">
              <span className="font-semibold">{c.name}</span>
              <span className="text-xs text-slate-500" dir="ltr">{c.ref_no} {c.city ? `· ${c.city}` : ""}</span>
            </Link>
          </li>
        ))}
        {(data ?? []).length === 0 && <li className="p-4 text-sm text-slate-500">لا يوجد عملاء مطابقون. <Link href="/customers/new" className={link}>أضف عميلًا</Link></li>}
      </ul>
    </section>
  );
}
