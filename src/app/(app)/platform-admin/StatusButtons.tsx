import ActionButton from "@/components/ui/ActionButton";
import { btnDangerOutline, btnPrimary, btnSecondary, btnSm } from "@/components/ui/styles";
import { setCompanyStatus } from "./actions";

/** إيقاف / أرشفة / إعادة الشركة للعمل حسب حالتها (pending · active · suspended · archived). التفعيل الأول يتم بقبول المدير للدعوة. */
export default function StatusButtons({ id, name, status, small = false }: { id: string; name: string; status: string; small?: boolean }) {
  const sm = small ? ` ${btnSm}` : "";
  const isActive = status === "active";
  const isPending = status === "pending";
  const isArchived = status === "archived";
  return (
    <div className="flex flex-wrap gap-2">
      {!isActive && !isPending && (
        <ActionButton action={setCompanyStatus} hidden={{ id, status: "active" }} label={isArchived ? "استعادة من الأرشيف" : "إعادة للعمل"}
          confirm={`إعادة الشركة «${name}» إلى العمل؟`} className={`${btnPrimary}${sm}`} />
      )}
      {isActive && (
        <ActionButton action={setCompanyStatus} hidden={{ id, status: "suspended" }} label="إيقاف"
          confirm={`إيقاف الشركة «${name}»؟ يتوقف وصول أعضائها دون حذف أي بيانات.`} className={`${btnDangerOutline}${sm}`} />
      )}
      {!isArchived && (
        <ActionButton action={setCompanyStatus} hidden={{ id, status: "archived" }} label="أرشفة"
          confirm={`أرشفة الشركة «${name}»؟ تُخفى من الشركات العاملة مع الاحتفاظ بكل بياناتها وسجلاتها.`} className={`${btnSecondary}${sm}`} />
      )}
    </div>
  );
}
