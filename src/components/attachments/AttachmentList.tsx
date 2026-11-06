import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { hasPhase5 } from "@/lib/schema";
import { formatDate } from "@/lib/format";
import { card, cardHeader, cardTitle } from "@/components/ui/styles";
import UploadForm from "./UploadForm";
import SafeImage from "./SafeImage";

const devName = (d: unknown) => (d as { name?: string } | null)?.name;
const STAGE: Record<string, string> = { before: "قبل الصيانة", after: "بعد الصيانة", general: "عامة", fault: "توثيق عطل", other: "مرفق آخر" };

/**
 * المرفقات والصور: روابط مؤقتة موقعة لا تعمل إلا لمن يملك صلاحية العرض.
 * deviceId: يعرض أيضًا صور الزيارات المرتبطة بهذا الجهاز (سجل صور الجهاز)؛ devices: أجهزة الزيارة لربط الصور بها عند الرفع.
 */
type Props = { entityType: string; entityId: string; canUpload: boolean; deviceId?: string; devices?: { id: string; name: string }[] };

/**
 * حد Suspense مستقل: القائمة تحتاج جولتين متتابعتين (السجلات ثم الروابط الموقعة ≈ 2 × 400 مللي ثانية)،
 * فلا تؤخر عرض بقية الصفحة؛ يظهر المحتوى الأساسي أولًا ثم تتدفق المرفقات عند جاهزيتها.
 */
export default function AttachmentList(props: Props) {
  return (
    <Suspense fallback={
      <section className={card} aria-busy="true">
        <div className={cardHeader}><h2 className={cardTitle}>الصور والمرفقات</h2></div>
        <div className="p-5"><div className="h-28 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" /></div>
      </section>
    }>
      <AttachmentListContent {...props} />
    </Suspense>
  );
}

async function AttachmentListContent({ entityType, entityId, canUpload, deviceId, devices }: Props) {
  const supabase = await createClient();
  // مرحلة الصورة وربطها بالجهاز (وسجل صور الجهاز من زياراته) تتطلب المرحلة الخامسة؛ قبلها تُعرض مرفقات السجل نفسه فقط
  const phase5 = await hasPhase5(supabase);
  const cols: string = "id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, created_at" + (phase5 ? ", photo_stage, device:devices(name)" : "");
  let q = supabase.from("attachments").select(cols)
    .is("archived_at", null).order("created_at", { ascending: false }).limit(200);
  q = deviceId && phase5 ? q.or(`and(entity_type.eq.${entityType},entity_id.eq.${entityId}),device_id.eq.${deviceId}`) : q.eq("entity_type", entityType).eq("entity_id", entityId);
  const { data, error } = await q;
  // فشل التحميل يُعرض صراحة، لا كقائمة فارغة توهم بعدم وجود مرفقات
  if (error) {
    console.error("attachments load failed:", error.code);
    return (
      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>الصور والمرفقات</h2></div>
        <p role="alert" className="p-5 text-sm text-red-700">تعذر تحميل المرفقات حاليًا. أعد تحميل الصفحة بعد قليل.</p>
      </section>
    );
  }
  type F = { id: string; entity_type: string; entity_id: string; storage_path: string; file_name: string; mime_type: string | null;
    size_bytes: number | null; created_at: string; photo_stage?: string | null; device?: unknown };
  const files = (data ?? []) as unknown as F[];
  // كل ملف يُحمَّل من المتصفح عبر /files/[id] (توقيع عند الطلب)؛ كانت القائمة تنتظر جولة توقيع ثانية
  const urlOf = (p: string) => { const f = files.find((x) => x.storage_path === p); return f ? `/files/${f.id}` : null; };

  return (
    <section className={card}>
      <div className={cardHeader}><h2 className={cardTitle}>الصور والمرفقات ({files.length})</h2></div>
      <div className="space-y-4 p-5">
        {files.length === 0 && <p className="text-sm text-slate-500">لا توجد مرفقات.</p>}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {files.map((f) => {
            const url = urlOf(f.storage_path);
            const isImg = f.mime_type?.startsWith("image/");
            return (
              <li key={f.id} className="overflow-hidden rounded-lg border border-slate-200">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                    {isImg ? (
                      <SafeImage src={url} alt={f.file_name} className="h-28 w-full bg-slate-50 object-cover" />
                    ) : (
                      <div className="flex h-28 items-center justify-center bg-slate-50 text-xs font-bold text-slate-500">PDF</div>
                    )}
                  </a>
                ) : <div className="flex h-28 items-center justify-center bg-slate-50 text-xs text-slate-400">غير متاح</div>}
                <div className="p-2 text-[11px]">
                  <p className="truncate font-semibold" title={f.file_name}>{f.file_name}</p>
                  <p className="text-slate-500">{formatDate(f.created_at)} · {Math.ceil((f.size_bytes ?? 0) / 1024)} ك.ب</p>
                  {(f.photo_stage || f.entity_type !== entityType || devName(f.device)) && (
                    <p className="text-slate-500">
                      {f.photo_stage && STAGE[f.photo_stage]}
                      {devName(f.device) && entityType !== "device" && ` · ${devName(f.device)}`}
                      {f.entity_type === "visit" && entityType !== "visit" && <> · <a href={`/visits/${f.entity_id}`} className="underline">الزيارة</a></>}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {canUpload && <UploadForm entityType={entityType} entityId={entityId} devices={phase5 ? devices : undefined} />}
      </div>
    </section>
  );
}
