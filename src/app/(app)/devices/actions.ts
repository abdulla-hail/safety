"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fromLocalInput } from "@/lib/format";
import { parseReadings } from "@/lib/readings";
import { hasInspections, hasPhase5 } from "@/lib/schema";
import { fail, intOrNull, list, str, strOrNull, type ActionState } from "@/lib/action-state";

const STATUSES = ["operational", "needs_maintenance", "under_repair", "out_of_service", "expired", "decommissioned"];

/** الموقع لا يُرسل في التعديل: تغييره بإجراء النقل فقط (device_move) لحفظ سجل النقل */
function devicePayload(fd: FormData) {
  const status = str(fd, "status");
  return {
    name: str(fd, "name"),
    manufacturer: strOrNull(fd, "manufacturer"),
    model: strOrNull(fd, "model"),
    device_type: strOrNull(fd, "device_type"),
    serial_number: strOrNull(fd, "serial_number"),
    location_detail: strOrNull(fd, "location_detail"),
    capacity: strOrNull(fd, "capacity"),
    installed_at: strOrNull(fd, "installed_at"),
    expires_at: strOrNull(fd, "expires_at"),
    status: status || "operational",
    schedule_start_date: strOrNull(fd, "schedule_start_date"),
    next_maintenance_at: strOrNull(fd, "next_maintenance_at"),
    notes: strOrNull(fd, "notes"),
  };
}

/** فترة الصيانة بالأشهر (1–60)؛ الفارغ = لا تغيير (الجهاز القديم يبقى على دورته بالأيام، والجديد يأخذ فترة نوعه أو الافتراضي) */
function intervalMonths(fd: FormData): number | null | "invalid" {
  const m = intOrNull(fd, "maintenance_interval_months");
  if (m === null) return null;
  return m >= 1 && m <= 60 ? m : "invalid";
}

const IMAGE_MAX = 5 * 1024 * 1024;
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** صورة الجهاز من النموذج: null إن لم تُختر، أو رسالة خطأ إن كانت غير صالحة */
function imageFile(fd: FormData): File | null | string {
  const f = fd.get("image");
  if (!(f instanceof File) || f.size === 0) return null;
  if (!IMAGE_EXT[f.type]) return "صيغة الصورة غير مدعومة؛ المسموح PNG أو JPEG أو WebP.";
  if (f.size > IMAGE_MAX) return "حجم الصورة يتجاوز 5 ميجابايت.";
  return f;
}

/**
 * يرفع الصورة إلى مسار الشركة والجهاز في الحاوية الخاصة ثم يحدّث السجل، ثم يحذف القديمة فقط بعد نجاح الاثنين.
 * سياسات التخزين وRLS تتحقق من الشركة والصلاحية؛ القاعدة ترفض أي مسار لا يطابق {الشركة}/device-image/{الجهاز}/.
 */
async function replaceDeviceImage(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, deviceId: string, file: File, oldPath: string | null) {
  const path = `${orgId}/device-image/${deviceId}/${crypto.randomUUID()}.${IMAGE_EXT[file.type]}`;
  const { error: upErr } = await supabase.storage.from("org-files").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return false;
  const { data, error } = await supabase.from("devices").update({ image_path: path }).eq("id", deviceId).eq("company_id", orgId).select("id");
  if (error || !data?.length) {
    await supabase.storage.from("org-files").remove([path]);
    return false;
  }
  if (oldPath) await supabase.storage.from("org-files").remove([oldPath]);
  return true;
}

export async function createDevice(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("devices.create");
  if (!ctx) return fail(prev, fd, "ليست لديك صلاحية تسجيل الأجهزة.");
  const customerId = str(fd, "customer_id");
  const systemId = str(fd, "system_id");
  const itemId = str(fd, "catalog_item_id");
  if (!isUuid(customerId)) return fail(prev, fd, "العميل مطلوب.", { customer_id: "مطلوب" });
  if (!isUuid(systemId)) return fail(prev, fd, "اختر نظام السلامة.", { system_id: "مطلوب" });
  const p = devicePayload(fd);
  if (!isUuid(itemId) && p.name.length < 2) return fail(prev, fd, "اختر الجهاز من الكتالوج أو أدخل اسمه.", { name: "مطلوب" });
  const months = intervalMonths(fd);
  if (months === "invalid") return fail(prev, fd, "فترة الصيانة بين شهر و60 شهرًا.", { maintenance_interval_months: "غير صالحة" });
  const image = imageFile(fd);
  if (typeof image === "string") return fail(prev, fd, image, { image });
  const supabase = await createClient();
  if (!(await allowedStatuses(supabase)).includes(p.status)) return fail(prev, fd, "الحالة التشغيلية المختارة غير متاحة.", { status: "غير متاحة" });
  // معرّف الجهاز يولّده النموذج مرة واحدة: إعادة الإرسال بعد انقطاع لا تنشئ جهازًا مكررًا (المفتاح الأساسي يرفض التكرار)
  const clientId = str(fd, "client_id");
  const deviceId = isUuid(clientId) ? clientId : crypto.randomUUID();
  // كل جهاز في موقع محدد؛ موقع وحيد يُستخدم تلقائيًا، وعميل بلا مواقع يُنشأ له «الموقع الرئيسي» صراحة (موضّح في النموذج)
  let siteId = str(fd, "site_id");
  if (!isUuid(siteId)) {
    const { data: sites, error: sErr } = await supabase.from("customer_sites").select("id").eq("customer_id", customerId).is("archived_at", null).limit(2);
    if (sErr) return fail(prev, fd, dbErrorMessage(sErr));
    if ((sites ?? []).length > 1) return fail(prev, fd, "حدد موقع الجهاز لدى العميل.", { site_id: "مطلوب" });
    if (sites?.length === 1) siteId = sites[0].id;
    else {
      const { data: main, error: mErr } = await supabase.from("customer_sites")
        .insert({ company_id: ctx.orgId, customer_id: customerId, name: "الموقع الرئيسي" }).select("id").single();
      if (mErr) return fail(prev, fd, `تعذر إنشاء الموقع الرئيسي للعميل: ${dbErrorMessage(mErr)}`);
      siteId = main.id;
    }
  }
  const { error } = await supabase.from("devices").insert({
    ...p,
    id: deviceId,
    maintenance_interval_months: months,
    site_id: siteId,
    company_id: ctx.orgId,
    customer_id: customerId,
    system_id: systemId,
    catalog_item_id: isUuid(itemId) ? itemId : null,
  });
  if (error) {
    // إرسال مكرر وصل بعد نجاح الأول: الجهاز محفوظ بالمعرّف نفسه
    if (error.code === "23505" && /devices_pkey/.test(error.message ?? "")) return finishCreate(supabase, ctx.orgId, deviceId, image);
    return fail(prev, fd, error.code === "23505" ? "يوجد جهاز نشط بالرقم التسلسلي نفسه لدى هذه الشركة المصنعة." : dbErrorMessage(error));
  }
  return finishCreate(supabase, ctx.orgId, deviceId, image);
}

/** بعد حفظ الجهاز: رفع الصورة (إن وُجدت) ثم التحويل؛ رسالة النجاح في صفحة الجهاز تذكر صراحة إن تعذر حفظ الصورة */
async function finishCreate(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, deviceId: string, image: File | null): Promise<never> {
  let imageOk = true;
  if (image) {
    const { data: d } = await supabase.from("devices").select("image_path").eq("id", deviceId).maybeSingle();
    imageOk = d?.image_path ? true : await replaceDeviceImage(supabase, orgId, deviceId, image, null);
  }
  revalidatePath("/devices");
  redirect(`/devices/${deviceId}?ok=created${imageOk ? "" : "&img=failed"}`);
}

const STATUSES_P5 = [...STATUSES.slice(0, 2), "faulty", ...STATUSES.slice(2, 5), "replaced", "decommissioned"];
/** حالات الجهاز المقبولة في القاعدة الحالية (معطل/مستبدل تتطلبان المرحلة الخامسة) */
async function allowedStatuses(supabase: Awaited<ReturnType<typeof createClient>>) {
  return (await hasPhase5(supabase)) ? STATUSES_P5 : STATUSES;
}

export async function updateDevice(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("devices.update");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعديل الأجهزة.");
  const p = devicePayload(fd);
  if (p.name.length < 2) return fail(prev, fd, "اسم الجهاز مطلوب.", { name: "مطلوب" });
  const months = intervalMonths(fd);
  if (months === "invalid") return fail(prev, fd, "فترة الصيانة بين شهر و60 شهرًا.", { maintenance_interval_months: "غير صالحة" });
  const image = imageFile(fd);
  if (typeof image === "string") return fail(prev, fd, image, { image });
  const supabase = await createClient();
  if (!(await allowedStatuses(supabase)).includes(p.status)) return fail(prev, fd, "الحالة التشغيلية المختارة غير متاحة.", { status: "غير متاحة" });
  // بعد ترحيل 20261106000100 الموعد القادم يتغير بإجراء device_set_next_due الموثق فقط
  const { next_maintenance_at: nextDue, ...rest } = p;
  const patch = (await hasInspections(supabase)) ? rest : { ...rest, next_maintenance_at: nextDue };
  const { data, error } = await supabase.from("devices").update({ ...patch, ...(months ? { maintenance_interval_months: months } : {}) })
    .eq("id", id).eq("company_id", ctx.orgId).select("id, image_path");
  if (error) return fail(prev, fd, error.code === "23505" ? "يوجد جهاز نشط بالرقم التسلسلي نفسه." : dbErrorMessage(error));
  if (!data?.length) return fail(prev, fd, "الجهاز غير موجود أو لا تملك صلاحية تعديله.");
  const oldPath = (data[0].image_path as string | null) ?? null;
  if (image) {
    if (!(await replaceDeviceImage(supabase, ctx.orgId, id, image, oldPath))) {
      return { ok: false, message: "حُفظت بيانات الجهاز، لكن تعذر رفع الصورة الجديدة؛ بقيت الصورة السابقة كما هي. حاول مجددًا.", attempt: (prev.attempt ?? 0) + 1 };
    }
  } else if (str(fd, "remove_image") === "1" && oldPath) {
    const { error: e } = await supabase.from("devices").update({ image_path: null }).eq("id", id).eq("company_id", ctx.orgId);
    if (e) return { ok: false, message: `حُفظت البيانات، لكن تعذر حذف الصورة: ${dbErrorMessage(e)}`, attempt: (prev.attempt ?? 0) + 1 };
    await supabase.storage.from("org-files").remove([oldPath]);
  }
  revalidatePath(`/devices/${id}`);
  redirect(`/devices/${id}?ok=saved`);
}

/** نقل الجهاز إلى موقع آخر (للعميل نفسه، أو لعميل آخر بصلاحية devices.transfer)؛ القاعدة تتحقق وتحفظ سجل النقل */
export async function moveDevice(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("devices.update");
  const id = str(fd, "device_id");
  const site = str(fd, "to_site_id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية نقل الأجهزة.");
  if (!isUuid(site)) return fail(prev, fd, "اختر الموقع الجديد.", { to_site_id: "مطلوب" });
  const reason = str(fd, "reason");
  if (reason.length < 3) return fail(prev, fd, "اذكر سبب النقل.", { reason: "مطلوب" });
  const at = fromLocalInput(str(fd, "moved_at"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("device_move", { p_device: id, p_to_site: site, p_reason: reason.slice(0, 500), p_moved_at: at });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/devices/${id}`);
  revalidatePath("/devices");
  return { ok: true, message: "تم نقل الجهاز وحُفظ سجل النقل. الزيارات وسجلات الصيانة السابقة بقيت في موقعها الأصلي.", attempt: (prev.attempt ?? 0) + 1 };
}

/** فترة صيانة واحدة لأجهزة عميل (أو أحد مواقعه)؛ لا تتغير المواعيد القائمة إلا عند اختيار إعادة الحساب صراحة */
export async function setCustomerSchedule(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("devices.update");
  const customerId = str(fd, "customer_id");
  const siteId = str(fd, "site_id");
  if (!ctx || !isUuid(customerId)) return fail(prev, fd, "ليست لديك صلاحية تعديل الأجهزة.");
  const months = intervalMonths(fd);
  if (!months || months === "invalid") return fail(prev, fd, "اختر فترة الصيانة.", { maintenance_interval_months: "مطلوبة" });
  const supabase = await createClient();
  let q = supabase.from("devices").select("id").eq("company_id", ctx.orgId).eq("customer_id", customerId).is("archived_at", null).limit(2000);
  if (isUuid(siteId)) q = q.eq("site_id", siteId);
  const { data: devs, error: e1 } = await q;
  if (e1) return fail(prev, fd, dbErrorMessage(e1));
  if (!devs?.length) return fail(prev, fd, "لا توجد أجهزة نشطة مطابقة.");
  const recalc = str(fd, "recalculate") === "1";
  const { data, error } = await supabase.rpc("devices_set_schedule", {
    p_devices: devs.map((d) => d.id), p_months: months, p_start: strOrNull(fd, "schedule_start_date"), p_recalculate: recalc,
  });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: `طُبّقت الفترة على ${data} جهاز${recalc ? " وأُعيد حساب مواعيدها" : "؛ المواعيد الحالية لم تتغير وتُحسب الفترة الجديدة بعد الصيانة القادمة"}.`, attempt: (prev.attempt ?? 0) + 1 };
}

/** تصحيح موثق لسجل صيانة (maintenance_correct): لا يعدّل السجل الأصلي */
export async function correctMaintenance(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("maintenance.correct");
  const recordId = str(fd, "record_id");
  const deviceId = str(fd, "device_id");
  const field = str(fd, "field");
  if (!ctx || !isUuid(recordId)) return fail(prev, fd, "ليست لديك صلاحية تصحيح السجلات.");
  if (!["result", "notes", "actions_taken", "recommendations"].includes(field)) return fail(prev, fd, "اختر الحقل.");
  const value = str(fd, "new_value").slice(0, 2000);
  const reason = str(fd, "reason");
  if (!value) return fail(prev, fd, "اكتب القيمة الصحيحة.", { new_value: "مطلوب" });
  if (reason.length < 5) return fail(prev, fd, "اذكر سبب التصحيح.", { reason: "مطلوب" });
  if (field === "result" && !RESULTS.includes(value)) return fail(prev, fd, "النتيجة: pass أو pass_with_notes أو fail.", { new_value: "غير صالحة" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("maintenance_correct", { p_record: recordId, p_field: field, p_new_value: value, p_reason: reason.slice(0, 1000) });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  if (isUuid(deviceId)) revalidatePath(`/devices/${deviceId}`);
  return { ok: true, message: "حُفظ التصحيح مع سببه؛ السجل الأصلي باقٍ كما هو.", attempt: (prev.attempt ?? 0) + 1 };
}

const KINDS = ["periodic", "corrective", "follow_up", "installation", "other"];

const ACTIONS = ["installation", "inspection", "test", "cleaning", "refill", "part_replacement", "repair", "decommission"];
const RESULTS = ["pass", "pass_with_notes", "fail"];

export async function addMaintenance(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("maintenance.create");
  const deviceId = str(fd, "device_id");
  if (!ctx || !isUuid(deviceId)) return fail(prev, fd, "ليست لديك صلاحية تسجيل الصيانة.");
  const action = str(fd, "action");
  const result = str(fd, "result");
  const statusAfter = str(fd, "status_after");
  if (!ACTIONS.includes(action)) return fail(prev, fd, "اختر نوع العملية.", { action: "مطلوب" });
  if (!RESULTS.includes(result)) return fail(prev, fd, "اختر نتيجة الفحص.", { result: "مطلوب" });
  const visit = str(fd, "visit_id");
  const wo = str(fd, "work_order_id");
  const performed = fromLocalInput(str(fd, "performed_at")) ?? new Date().toISOString();
  if (new Date(performed).getTime() > Date.now() + 5 * 60_000) return fail(prev, fd, "لا يمكن تسجيل صيانة بتاريخ مستقبلي.", { performed_at: "تاريخ مستقبلي" });

  const readings = parseReadings(str(fd, "readings"));
  if (readings === "invalid") return fail(prev, fd, "اكتب كل قراءة في سطر بصيغة: الاسم = القيمة (حتى 30 قراءة).", { readings: "صيغة غير صالحة" });
  const kind = KINDS.includes(str(fd, "kind")) ? str(fd, "kind") : null;
  const supabase = await createClient();
  const phase5 = await hasPhase5(supabase);
  if (!(phase5 ? STATUSES_P5 : STATUSES).includes(statusAfter)) return fail(prev, fd, "حالة الجهاز بعد العملية غير متاحة.", { status_after: "غير متاحة" });
  const actionsTaken = strOrNull(fd, "actions_taken"), recommendations = strOrNull(fd, "recommendations");
  // قبل المرحلة الخامسة لا توجد أعمدة القراءات والإجراءات والتوصيات: تُحفظ نصًا ضمن الملاحظات فلا يُفقد ما أدخله الفني
  const readingText = Object.entries(readings).map(([k, v]) => `${k}: ${v}`).join("، ");
  const notes = phase5 ? strOrNull(fd, "notes") : [strOrNull(fd, "notes"), readingText && `القراءات: ${readingText}`,
    actionsTaken && `الإجراءات المنفذة: ${actionsTaken}`, recommendations && `التوصيات: ${recommendations}`].filter(Boolean).join("\n") || null;
  // معرّف السجل يولّده النموذج: إعادة الإرسال بعد انقطاع لا تكرر العملية (سجل الصيانة لا يُعدَّل ولا يُحذف)
  const clientId = str(fd, "client_id");
  const recordId = isUuid(clientId) ? clientId : crypto.randomUUID();
  const { error } = await supabase.from("maintenance_records").insert({
    id: recordId,
    company_id: ctx.orgId,
    device_id: deviceId,
    action, result, status_after: statusAfter,
    performed_at: performed,
    ...(kind ? { kind } : {}),
    ...(phase5 ? { readings, actions_taken: actionsTaken, recommendations } : {}),
    notes,
    next_due_at: strOrNull(fd, "next_due_at"),
    visit_id: isUuid(visit) ? visit : null,
    work_order_id: isUuid(wo) ? wo : null,
  });
  const duplicate = error?.code === "23505" && /maintenance_records_pkey/.test(error.message ?? "");
  if (error && !duplicate) return fail(prev, fd, dbErrorMessage(error));

  const techIds = [...new Set(list(fd, "technician_ids").filter(isUuid))];
  if (techIds.length) {
    const { error: e2 } = await supabase.from("maintenance_record_technicians")
      .upsert(techIds.map((technician_id) => ({ record_id: recordId, technician_id, company_id: ctx.orgId })),
        { onConflict: "record_id,technician_id", ignoreDuplicates: true });
    if (e2) return { ok: false, message: `حُفظت عملية الصيانة، لكن تعذر ربط الفنيين المنفذين: ${dbErrorMessage(e2)}`, attempt: (prev.attempt ?? 0) + 1, values: { client_id: recordId } };
  }
  revalidatePath(`/devices/${deviceId}`);
  return { ok: true, message: duplicate ? "عملية الصيانة محفوظة مسبقًا (لم تُكرر)." : "تم تسجيل عملية الصيانة وتحديث حالة الجهاز وموعد صيانته القادمة.", attempt: (prev.attempt ?? 0) + 1 };
}

/** تعديل يدوي موثق لموعد الصيانة القادمة (device_set_next_due): يُحفظ القديم والجديد والسبب والمنفّذ */
export async function setNextDue(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("maintenance.reschedule");
  const id = str(fd, "device_id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعديل موعد الصيانة.");
  const date = str(fd, "next_due");
  const reason = str(fd, "reason");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(prev, fd, "حدد الموعد الجديد.", { next_due: "مطلوب" });
  if (reason.length < 5) return fail(prev, fd, "اذكر سبب تعديل الموعد.", { reason: "مطلوب" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("device_set_next_due", { p_device: id, p_date: date, p_reason: reason.slice(0, 1000) });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/devices/${id}`);
  return { ok: true, message: "عُدّل الموعد وحُفظ التغيير (القديم والجديد والسبب) في سجل الجهاز.", attempt: (prev.attempt ?? 0) + 1 };
}