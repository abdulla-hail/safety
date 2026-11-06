import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import { card } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { siteFields } from "../../../customers/fields";
import { updateSite } from "../../actions";

export const metadata = { title: "تعديل موقع | عين السلامة" };

export default async function EditSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("sites.update");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: s } = await supabase.from("customer_sites").select("*").eq("id", id).eq("company_id", ctx.orgId).maybeSingle();
  if (!s) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`تعديل: ${s.name}`} refNo={s.ref_no} crumbs={[{ label: "المواقع", href: "/sites" }, { label: s.name, href: `/sites/${id}` }, { label: "تعديل" }]} />
      <section className={`${card} p-6`}>
        <EntityForm action={updateSite} fields={[{ name: "id", label: "", type: "hidden" }, ...siteFields]} initial={s} cancelHref={`/sites/${id}`} />
      </section>
    </div>
  );
}
