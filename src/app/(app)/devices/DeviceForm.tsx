"use client";

import Link from "next/link";
import { startTransition, useActionState, useMemo, useState } from "react";
import { btnPrimary, btnSecondary, input, label } from "@/components/ui/styles";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { deviceStatus } from "@/lib/labels";

export interface CatalogItemOption {
  id: string; system_id: string; name: string; manufacturer: string | null; model: string | null;
  device_type: string | null; default_interval_days: number | null;
}

type Values = Record<string, string | number | null | undefined>;

/**
 * نموذج تسجيل/تعديل جهاز: اختيار النظام ثم تعريف الجهاز من الكتالوج يعبّئ الاسم والمصنع
 * والموديل والنوع ودورة الصيانة تلقائيًا، مع إمكانية التعديل قبل الحفظ.
 */
export default function DeviceForm({
  action, mode, customer, sites, systems, items, initial = {}, cancelHref, currentImageUrl = null, defaultMonths = 3, statusKeys, clientId, dueLocked = false, brands = [],
}: {
  /** ماركات الكتالوج: تُقترح في «الشركة المصنعة» (ويُقبل غيرها) */
  brands?: string[];
  /** بعد ترحيل 20261106000100: الموعد القادم لا يُعدَّل من نموذج التعديل، بل بإجراء «تعديل الموعد» الموثق في صفحة الجهاز */
  dueLocked?: boolean;
  /** الحالات المقبولة في القاعدة الحالية (افتراضيًا كل الحالات المعرّفة) */
  statusKeys?: string[];
  /** معرّف الجهاز الجديد يولّده الخادم مرة لكل فتح للنموذج: إعادة الإرسال بعد خطأ أو انقطاع لا تنشئ جهازًا مكررًا */
  clientId?: string;
  /** الفترة الافتراضية للشركة بالأشهر (تُطبَّق في القاعدة إن لم يكن للنوع فترة) */
  defaultMonths?: number;
  /** رابط مؤقت للصورة الحالية عند التعديل */
  currentImageUrl?: string | null;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  mode: "create" | "edit";
  customer: { id: string; name: string };
  sites: { id: string; name: string }[];
  systems: { id: string; name: string; default_interval_days: number | null }[];
  items: CatalogItemOption[];
  initial?: Values;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const sv = (state.values ?? {}) as Record<string, string>;
  const start = (k: string) => String(sv[k] ?? initial[k] ?? "");

  const [systemId, setSystemId] = useState(start("system_id"));
  const [itemId, setItemId] = useState(start("catalog_item_id"));
  const [auto, setAuto] = useState({
    name: start("name"), manufacturer: start("manufacturer"), model: start("model"),
    device_type: start("device_type"), maintenance_interval_days: start("maintenance_interval_days"),
  });
  const systemItems = useMemo(() => items.filter((i) => i.system_id === systemId), [items, systemId]);
  const legacyDays = initial.maintenance_interval_months ? null : initial.maintenance_interval_days ?? null;
  const [preview, setPreview] = useState<string | null>(currentImageUrl ?? null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState("");

  function pickSystem(id: string) {
    setSystemId(id);
    setItemId("");
    const sys = systems.find((s) => s.id === id);
    setAuto((a) => ({ ...a, maintenance_interval_days: sys?.default_interval_days ? String(sys.default_interval_days) : a.maintenance_interval_days }));
  }
  function pickItem(id: string) {
    setItemId(id);
    const it = items.find((i) => i.id === id);
    if (it) {
      setAuto({
        name: it.name, manufacturer: it.manufacturer ?? "", model: it.model ?? "", device_type: it.device_type ?? "",
        maintenance_interval_days: it.default_interval_days ? String(it.default_interval_days) : auto.maintenance_interval_days,
      });
    }
  }
  const err = (k: string) => state.errors?.[k] && <p className="mt-1 text-xs text-red-700">{state.errors[k]}</p>;
  const field = (name: keyof typeof auto, text: string, extra: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`d-${name}`} className={label}>{text}</label>
      <input id={`d-${name}`} name={name} value={auto[name]} onChange={(e) => setAuto((a) => ({ ...a, [name]: e.target.value }))} className={input} {...extra} />
      {err(name)}
    </div>
  );
  const plain = (name: string, text: string, type = "text", extra: Record<string, unknown> = {}) => (
    <div key={`${name}-${state.attempt ?? 0}`}>
      <label htmlFor={`d-${name}`} className={label}>{text}</label>
      <input id={`d-${name}`} name={name} type={type} defaultValue={start(name)} className={input} {...extra} />
      {err(name)}
    </div>
  );

  return (
    // الإرسال يدويًا (دون إعادة تعيين النموذج التلقائية) فتبقى الصورة المختارة وكل الحقول عند فشل الحفظ
    <form className="space-y-6" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      startTransition(() => formAction(fd));
    }}>
      {mode === "create" && clientId && <input type="hidden" name="client_id" value={clientId} />}
      {state.message && <p role="alert" className={`rounded-lg p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{state.message}</p>}
      <input type="hidden" name="customer_id" value={customer.id} />
      {mode === "edit" && <input type="hidden" name="id" value={String(initial.id ?? "")} />}

      <fieldset className="grid grid-cols-1 gap-5 rounded-xl border border-slate-200 p-4 md:grid-cols-2">
        <legend className="px-2 text-sm font-bold text-primary">1. التعريف من كتالوج أجهزة السلامة</legend>
        <div>
          <label htmlFor="d-system" className={label}>نظام السلامة <span className="text-danger">*</span></label>
          {mode === "create" ? (
            <select id="d-system" name="system_id" value={systemId} onChange={(e) => pickSystem(e.target.value)} className={input} required>
              <option value="">اختر النظام...</option>
              {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{systems.find((s) => s.id === systemId)?.name ?? "—"}</p>
          )}
          {err("system_id")}
        </div>
        <div>
          <label htmlFor="d-item" className={label}>الجهاز / الموديل</label>
          {mode === "create" ? (
            <select id="d-item" name="catalog_item_id" value={itemId} onChange={(e) => pickItem(e.target.value)} className={input} disabled={!systemId}>
              <option value="">{systemId ? (systemItems.length ? "اختر من الكتالوج..." : "لا توجد تعريفات لهذا النظام — أدخل البيانات يدويًا") : "اختر النظام أولًا"}</option>
              {systemItems.map((i) => <option key={i.id} value={i.id}>{i.name}{i.model ? ` — ${i.model}` : ""}</option>)}
            </select>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{items.find((i) => i.id === itemId)?.name ?? "إدخال يدوي"}</p>
          )}
          <p className="mt-1 text-xs text-slate-500">يملأ الاسم والمصنع والموديل تلقائيًا، ويمكن تعديلها.</p>
        </div>
        {field("name", "اسم الجهاز *", { required: true, maxLength: 200 })}
        {field("device_type", "النوع")}
        {field("manufacturer", "الشركة المصنعة", brands.length ? { list: "d-brands" } : {})}
        {brands.length > 0 && <datalist id="d-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>}
        {field("model", "الموديل", { dir: "ltr" })}
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-5 rounded-xl border border-slate-200 p-4 md:grid-cols-2">
        <legend className="px-2 text-sm font-bold text-primary">2. الجهاز الفعلي وموقعه</legend>
        <div>
          <p className={label}>العميل</p>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{customer.name}</p>
        </div>
        {mode === "create" ? (
          <div key={`site-${state.attempt ?? 0}`}>
            <label htmlFor="d-site" className={label}>الموقع / الفرع <span className="text-danger">*</span></label>
            {sites.length > 0 ? (
              <select id="d-site" name="site_id" defaultValue={start("site_id") || (sites.length === 1 ? sites[0].id : "")} className={input} required>
                <option value="">اختر موقع الجهاز...</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs text-slate-700">
                لا توجد مواقع لهذا العميل؛ سيُنشأ له موقع باسم «الموقع الرئيسي» ويُسجَّل الجهاز فيه. يمكنك تعديل اسمه لاحقًا أو <Link className="underline" href={`/customers/${customer.id}`}>إضافة موقع</Link> أولًا.
              </p>
            )}
            {err("site_id")}
          </div>
        ) : (
          <div>
            <p className={label}>الموقع / الفرع</p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{sites.find((s) => s.id === String(initial.site_id ?? ""))?.name ?? "بلا موقع"}</p>
            <p className="mt-1 text-xs text-slate-500">يتغير الموقع بإجراء «نقل الجهاز» في صفحة الجهاز حتى يُحفظ سجل النقل.</p>
          </div>
        )}
        {plain("serial_number", "الرقم التسلسلي", "text", { dir: "ltr", maxLength: 120 })}
        {plain("location_detail", "الموقع الدقيق داخل الفرع", "text", { placeholder: "مثال: الدور الأول - بجوار المصعد" })}
        {plain("capacity", "السعة / المواصفة")}
        <div key={`st-${state.attempt ?? 0}`}>
          <label htmlFor="d-status" className={label}>الحالة التشغيلية</label>
          <select id="d-status" name="status" defaultValue={start("status") || "operational"} className={input}>
            {Object.entries(deviceStatus).filter(([k]) => !statusKeys || statusKeys.includes(k)).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {plain("installed_at", "تاريخ التركيب", "date")}
        {plain("expires_at", "تاريخ انتهاء الصلاحية", "date")}
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-5 rounded-xl border border-slate-200 p-4 md:grid-cols-2">
        <legend className="px-2 text-sm font-bold text-primary">3. الصيانة الدورية</legend>
        <div key={`im-${state.attempt ?? 0}`}>
          <label htmlFor="d-months" className={label}>فترة الصيانة الدورية</label>
          <select id="d-months" name="maintenance_interval_months" defaultValue={start("maintenance_interval_months") || (mode === "create" ? "" : "")} className={input}>
            <option value="">{mode === "create" ? `حسب نوع الجهاز، وإلا الافتراضي (${defaultMonths} أشهر)` : legacyDays ? `دورة قديمة: كل ${legacyDays} يوم` : "—"}</option>
            {[1, 2, 3, 4, 6, 12, 18, 24, 36, 60].map((m) => <option key={m} value={m}>{m === 1 ? "شهر" : m === 2 ? "شهران" : m <= 10 ? `${m} أشهر` : `${m} شهرًا`}</option>)}
          </select>
          {err("maintenance_interval_months")}
        </div>
        {plain("schedule_start_date", "تاريخ بداية الجدول", "date")}
        {dueLocked ? (
          <div>
            <p className={label}>موعد الصيانة القادمة</p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{initial.next_maintenance_at ? String(initial.next_maintenance_at) : "—"}</p>
            <p className="mt-1 text-xs text-slate-500">يُعدَّل من صفحة الجهاز بإجراء «تعديل الموعد» مع ذكر السبب، ويُحفظ القديم والجديد.</p>
          </div>
        ) : plain("next_maintenance_at", "موعد الصيانة القادمة", "date")}
        <p className="text-xs text-slate-500 md:col-span-2">
          تبدأ الجدولة من تاريخ البداية (أو التركيب)، ويُحسب الموعد القادم تلقائيًا إن تُرك فارغًا، ويتحدّث فقط عند تسجيل صيانة دورية مكتملة.
          تغيير الموعد يدويًا يحفظ الاستحقاق السابق في سجل الاستحقاقات. الإصلاح الطارئ لا يغيّر الموعد.
        </p>
        <div className="md:col-span-2" key={`n-${state.attempt ?? 0}`}>
          <label htmlFor="d-notes" className={label}>ملاحظات</label>
          <textarea id="d-notes" name="notes" rows={3} defaultValue={start("notes")} className={input} maxLength={2000} />
        </div>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-[auto_1fr]">
        <legend className="px-2 text-sm font-bold text-primary">4. صورة الجهاز (اختيارية)</legend>
        <div className="flex size-32 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
          {preview && !removeImage
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={preview} alt="معاينة صورة الجهاز" className="size-full object-contain" />
            : <span className="px-2 text-center text-xs text-slate-400">لا توجد صورة</span>}
        </div>
        <div className="space-y-2">
          <label htmlFor="d-image" className={label}>{currentImageUrl ? "تغيير الصورة" : "رفع صورة"}</label>
          <input id="d-image" name="image" type="file" accept="image/png,image/jpeg,image/webp" className={`${input} file:me-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              setImageError(f && f.size > 5 * 1024 * 1024 ? "حجم الصورة يتجاوز 5 ميجابايت." : f && !["image/png", "image/jpeg", "image/webp"].includes(f.type) ? "المسموح PNG أو JPEG أو WebP." : "");
              setPreview(f ? URL.createObjectURL(f) : currentImageUrl ?? null);
              if (f) setRemoveImage(false);
            }} />
          <p className="text-xs text-slate-500">PNG أو JPEG أو WebP حتى 5 ميجابايت. تُحفظ في تخزين خاص بالشركة ولا تظهر إلا لمن يرى الجهاز. الحفظ يعمل دون صورة.</p>
          {(imageError || state.errors?.image) && <p className="text-xs text-red-700" role="alert">{imageError || state.errors?.image}</p>}
          {mode === "edit" && currentImageUrl && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="remove_image" value="1" checked={removeImage} onChange={(e) => setRemoveImage(e.target.checked)} className="size-4 accent-[var(--brand)]" />
              حذف الصورة الحالية
            </label>
          )}
        </div>
      </fieldset>

      {mode === "create" && (
        <p className="rounded-lg bg-brand-soft p-3 text-xs text-slate-700">
          عند الحفظ يُنشأ للجهاز رقم مرجعي فريد (DEV-) ورمز QR/باركود دائم لا يتغير بتعديل البيانات ولا يُعاد استخدامه.
        </p>
      )}
      <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-5">
        <button aria-busy={pending} type="submit" disabled={pending || !!imageError} className={btnPrimary}>{pending ? "جارٍ الحفظ..." : mode === "create" ? "تسجيل الجهاز" : "حفظ التغييرات"}</button>
        <Link href={cancelHref} className={btnSecondary}>إلغاء</Link>
      </div>
    </form>
  );
}
