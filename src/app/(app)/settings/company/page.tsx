import PageHeader from "@/components/ui/PageHeader";
import ActionButton from "@/components/ui/ActionButton";
import { btnSecondary, btnSm, card, cardHeader, cardTitle } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import EntityForm from "@/components/ui/EntityForm";
import BrandingForm, { type CompanyValues } from "./BrandingForm";
import { restoreBranding, saveMaintenanceSettings } from "./actions";
import { saveMailSettings, testMailSettings } from "./mail-actions";
import { secretsConfigured } from "@/lib/secret";

export const metadata = { title: "بيانات الشركة والهوية | عين السلامة" };

export default async function CompanySettingsPage() {
  const ctx = await requireOrg("settings.branding");
  const supabase = await createClient();
  // جولة واحدة للبيانات والسجل، ثم توقيع الصورتين معًا (كان هناك 3–4 طلبات متتابعة)
  const [{ data: b }, { data: mail }, history] = await Promise.all([
    supabase.from("companies")
      .select("id, ref_no, name, legal_name, phone, email, website, city, address, vat_number, license_no, commercial_registration, primary_color, secondary_color, header_text, footer_text, signature_name, signature_title, show_logo_in_reports, show_contact_in_reports, show_stamp_in_reports, maintenance_alert_days, alert_lead_days, default_interval_months, schedule_policy, escalation_days, logo_path, stamp_path")
      .eq("id", ctx.orgId).maybeSingle(),
    supabase.from("company_mail_settings").select("sender_name, sender_email, reply_to, smtp_host, smtp_port, smtp_secure, smtp_user, enabled, last_test_at, last_test_ok, last_test_error").eq("company_id", ctx.orgId).maybeSingle(),
    ctx.can("settings.branding")
      ? supabase.from("company_branding_history").select("id, snapshot, created_at").eq("company_id", ctx.orgId).order("created_at", { ascending: false }).limit(10)
      : null,
  ]);
  if (!b) return <p className="text-sm text-red-700">تعذر تحميل بيانات الشركة.</p>;
  // روابط المعاينة للشعار والختم حتى لو كان إظهارها في التقارير معطلًا
  const [logo, stamp] = await Promise.all([
    b.logo_path ? supabase.storage.from("org-branding").createSignedUrl(b.logo_path, 600) : null,
    b.stamp_path ? supabase.storage.from("org-branding").createSignedUrl(b.stamp_path, 600) : null,
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="هوية الشركة" refNo={b.ref_no}
        description="الهوية خاصة بشركتك فقط، وتظهر في القائمة وفي التقارير والمستندات والملصقات المطبوعة. انضمام الموظفين يتم بدعوات من «فريق الشركة»." />
      <BrandingForm v={b as CompanyValues}
        logoUrl={logo?.data?.signedUrl ?? null} stampUrl={stamp?.data?.signedUrl ?? null}
        canCompany={ctx.can("settings.branding")} canBranding={ctx.can("settings.branding")} />
      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>الصيانة الدورية والتنبيهات</h2></div>
        <div className="p-5">
          <EntityForm action={saveMaintenanceSettings} submitLabel="حفظ إعدادات الصيانة"
            initial={{ default_interval_months: String(b.default_interval_months ?? 3), schedule_policy: b.schedule_policy ?? "from_completion",
              lead_days: ((b.alert_lead_days as number[] | null) ?? [30, 15, 7, 1]).map(String), escalation_days: String(b.escalation_days ?? 7) }}
            fields={[
              { name: "default_interval_months", label: "الفترة الافتراضية للأجهزة الجديدة", type: "select",
                options: [1, 2, 3, 4, 6, 12].map((m) => ({ value: String(m), label: m === 1 ? "شهر" : m === 2 ? "شهران" : m <= 10 ? `${m} أشهر` : `${m} شهرًا` })),
                help: "تُستخدم إن لم يكن لنوع الجهاز أو تعريفه في الكتالوج فترة خاصة." },
              { name: "schedule_policy", label: "حساب الموعد القادم", type: "select", options: [
                { value: "from_completion", label: "من تاريخ إنجاز الصيانة" },
                { value: "fixed", label: "ثابت على تقويم بداية الجدول (التأخير لا يزيح المواعيد)" }] },
              { name: "lead_days", label: "التنبيه المسبق قبل الموعد (اختر مرحلة أو أكثر)", type: "checkboxes", wide: true,
                options: [60, 30, 15, 7, 3, 1].map((d) => ({ value: String(d), label: d === 1 ? "قبل يوم" : `قبل ${d} يومًا` })) },
              { name: "escalation_days", label: "التصعيد للإدارة بعد تأخر (يوم)", type: "number", min: 1, max: 90 },
            ]} />
          <p className="mt-3 text-xs text-slate-500">تُحسب التنبيهات يوميًا الساعة 5 صباحًا (بتوقيت الرياض): تنبيه لكل مرحلة مسبقة مرة واحدة، ثم يوم الاستحقاق، ثم التأخر والتصعيد — للفني المسؤول حسب الإسناد وللإدارة، دون تكرار. تغيير الإعدادات لا يغيّر مواعيد الأجهزة القائمة.</p>
        </div>
      </section>
      <section className={card} id="mail">
        <div className={cardHeader}><h2 className={cardTitle}>البريد الرسمي للمراسلات مع العملاء</h2>
          {mail?.last_test_at && <span className={`text-xs ${mail.last_test_ok ? "text-green-700" : "text-red-700"}`}>آخر اختبار {formatDateTime(mail.last_test_at)}: {mail.last_test_ok ? "نجح" : mail.last_test_error ?? "فشل"}</span>}</div>
        <div className="space-y-4 p-5">
          <p className="text-xs text-slate-600">عروض الأسعار وتقارير المعاينة تُرسل للعميل من بريد شركتك عبر خادم SMTP الخاص بها، باسم الشركة وشعارها — لا يظهر اسم المنصة.
            بيانات الخادم من مزود بريدك (Google Workspace: smtp.gmail.com منفذ 465 مع «كلمة مرور التطبيقات»، Microsoft 365: smtp.office365.com منفذ 587، Hostinger: smtp.hostinger.com منفذ 465).</p>
          {!secretsConfigured() && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">مفتاح التشفير MAIL_ENCRYPTION_KEY غير مضبوط على الخادم؛ لا يمكن حفظ كلمة مرور البريد حتى يضبطه مسؤول الاستضافة.</p>}
          <EntityForm action={saveMailSettings} submitLabel="حفظ إعدادات البريد"
            initial={{ sender_name: mail?.sender_name ?? b.name, sender_email: mail?.sender_email ?? b.email ?? "", reply_to: mail?.reply_to ?? "",
              smtp_host: mail?.smtp_host ?? "", smtp_port: String(mail?.smtp_port ?? 465), smtp_secure: mail?.smtp_secure ?? true,
              smtp_user: mail?.smtp_user ?? "", enabled: mail?.enabled ?? false }}
            fields={[
              { name: "sender_name", label: "اسم المرسل الظاهر للعميل", maxLength: 120 },
              { name: "sender_email", label: "البريد الرسمي للمرسل", type: "email", dir: "ltr" },
              { name: "reply_to", label: "الرد على (اختياري)", type: "email", dir: "ltr" },
              { name: "smtp_host", label: "خادم SMTP", dir: "ltr", placeholder: "smtp.example.com" },
              { name: "smtp_port", label: "المنفذ", type: "number", min: 1, max: 65535 },
              { name: "smtp_user", label: "اسم المستخدم (عادةً البريد نفسه)", dir: "ltr" },
              { name: "smtp_password", label: "كلمة المرور (اتركها فارغة للإبقاء على الحالية)", type: "password", dir: "ltr" },
              { name: "smtp_secure", label: "اتصال مشفر مباشر SSL/TLS (منفذ 465). ألغِه لمنفذ 587 (STARTTLS)", type: "checkbox", wide: true },
              { name: "enabled", label: "تفعيل الإرسال من البريد الرسمي", type: "checkbox", wide: true },
            ]} />
          <div className="border-t border-slate-200 pt-4">
            <EntityForm action={testMailSettings} submitLabel="إرسال رسالة تجريبية" initial={{ to: ctx.user.email ?? "" }}
              fields={[{ name: "to", label: "إلى", type: "email", dir: "ltr" }]} />
          </div>
        </div>
      </section>
      {history && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>النسخ السابقة من الهوية</h2></div>
          <ul className="divide-y divide-slate-100">
            {(history.data ?? []).map((h) => {
              const s = h.snapshot as { primary_color: string; secondary_color: string; header_text: string | null; logo_path: string | null };
              return (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="size-6 rounded" style={{ backgroundColor: s.primary_color }} aria-hidden="true" />
                    <span className="size-6 rounded" style={{ backgroundColor: s.secondary_color }} aria-hidden="true" />
                    <span>{formatDateTime(h.created_at)}</span>
                    <span className="text-xs text-slate-500">{s.logo_path ? "مع شعار" : "بدون شعار"} {s.header_text ? `· ${s.header_text}` : ""}</span>
                  </div>
                  <ActionButton action={restoreBranding} hidden={{ id: h.id }} label="استعادة هذه الهوية" confirm="استعادة الألوان والشعار والترويسة من هذه النسخة؟" className={`${btnSecondary} ${btnSm}`} />
                </li>
              );
            })}
            {(history.data ?? []).length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد نسخ سابقة بعد.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
