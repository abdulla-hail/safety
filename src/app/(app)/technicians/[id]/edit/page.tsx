import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import { card } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { technicianFields } from "../../fields";
import { updateTechnician } from "../../actions";
import { memberOptions } from "../../members";

export const metadata = { title: "تعديل فني | عين السلامة" };

export default async function EditTechnicianPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("technicians.update");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: t }, members] = await Promise.all([
    supabase.from("technicians").select("*").eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    memberOptions(supabase, ctx.orgId),
  ]);
  if (!t) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`تعديل: ${t.full_name}`} refNo={t.ref_no} crumbs={[{ label: "فريق الشركة", href: "/team" }, { label: t.full_name, href: `/technicians/${id}` }, { label: "تعديل" }]} />
      <section className={`${card} p-6`}>
        <EntityForm action={updateTechnician} fields={[{ name: "id", label: "", type: "hidden" }, ...technicianFields(members)]}
          initial={{ ...t, is_active: String(t.is_active) }} cancelHref={`/technicians/${id}`} />
      </section>
    </div>
  );
}
