import { redirect } from "next/navigation";

/** قسم الفنيين المستقل أُلغي: الفنيون أعضاء في «فريق الشركة» ويُضافون بالدعوة، ويبقى ملف كل فني التشغيلي على /technicians/[id]. */
export default function TechniciansPage() {
  redirect("/team");
}
