import { redirect } from "next/navigation";

/** إضافة الفني تتم بدعوة من «فريق الشركة» فيُربط حسابه وسجله التشغيلي تلقائيًا عند القبول. */
export default function NewTechnicianPage() {
  redirect("/team#invite");
}
