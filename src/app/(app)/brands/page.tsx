import { redirect } from "next/navigation";

/** الماركات انتقلت إلى قسم فرعي داخل كتالوج الأجهزة؛ الرابط القديم يبقى صالحًا */
export default function BrandsRedirect() {
  redirect("/catalog/brands");
}
