import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import { card } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { updateItem } from "../../actions";
import { itemFields } from "../../fields";

export const metadata = { title: "تعديل تعريف جهاز | عين السلامة" };

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("catalog.manage");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: i } = await supabase.from("catalog_items").select("*, system:safety_systems(id, name)").eq("id", id).eq("company_id", ctx.orgId).maybeSingle();
  if (!i) notFound();
  const specs = Object.entries((i.specs ?? {}) as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join("\n");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`تعديل: ${i.name}`} refNo={i.ref_no}
        crumbs={[{ label: "الكتالوج", href: "/catalog" }, { label: i.system?.name ?? "—", href: `/catalog/${i.system_id}` }, { label: i.name }]}
        description="التعديل يؤثر على الأجهزة التي ستُسجل لاحقًا فقط؛ الأجهزة القائمة تحتفظ ببياناتها كما سُجلت." />
      <section className={`${card} p-6`}>
        <EntityForm action={updateItem} fields={[{ name: "id", label: "", type: "hidden" }, ...itemFields]}
          initial={{ ...i, specs, is_active: String(i.is_active) }} cancelHref={`/catalog/${i.system_id}`} />
      </section>
    </div>
  );
}
