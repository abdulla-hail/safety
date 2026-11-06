"use server";

import { revalidatePath } from "next/cache";
import { invalidateMyContext, platformForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { rpcErrorMessage } from "@/lib/invitations";
import { imageDimensions } from "@/lib/image-size";
import { invalidatePlatformLogo } from "@/lib/platform-branding";
import { str, type ActionState } from "@/lib/action-state";

const MAX_BYTES = 1024 * 1024;
const EXT: Record<string, string> = { png: "png", jpeg: "jpg", webp: "webp" };

/**
 * تغيير شعار المنصة (صلاحية platform.branding المستقلة). التحقق من النوع الفعلي من محتوى الملف وأبعاده وحجمه،
 * ثم الرفع، ثم اعتماد المسار في القاعدة؛ إن فشل الاعتماد يُحذف الملف الجديد ويبقى الشعار الحالي كما هو.
 */
export async function savePlatformLogo(prev: ActionState, fd: FormData): Promise<ActionState> {
  const attempt = (prev.attempt ?? 0) + 1;
  if (!(await platformForAction("platform.branding"))) return { ok: false, message: "ليست لديك صلاحية تغيير شعار المنصة.", attempt };
  const supabase = await createClient();

  if (str(fd, "reset") === "1") {
    const { error } = await supabase.rpc("platform_set_logo", { p_path: null });
    if (error) return { ok: false, message: rpcErrorMessage(error), attempt };
    return done("أُعيد الشعار الافتراضي للمنصة.", attempt);
  }

  const file = fd.get("logo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "اختر ملف الشعار.", attempt };
  if (file.size > MAX_BYTES) return { ok: false, message: "الحد الأقصى لحجم الشعار 1 ميجابايت.", attempt };
  const dims = imageDimensions(new Uint8Array(await file.arrayBuffer()));
  if (!dims) return { ok: false, message: "صيغة غير مدعومة أو ملف تالف؛ المسموح PNG أو JPEG أو WebP.", attempt };
  if (dims.width < 64 || dims.height < 64) return { ok: false, message: `الأبعاد ${dims.width}×${dims.height} صغيرة؛ الحد الأدنى 64×64 بكسل.`, attempt };
  if (dims.width > 2048 || dims.height > 2048) return { ok: false, message: `الأبعاد ${dims.width}×${dims.height} كبيرة؛ الحد الأقصى 2048×2048 بكسل.`, attempt };
  if (dims.width / dims.height > 6 || dims.height / dims.width > 3) return { ok: false, message: "نسبة الأبعاد غير مناسبة لشعار (عرض حتى 6 أضعاف الارتفاع).", attempt };

  const path = `logo/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${EXT[dims.type]}`;
  const contentType = dims.type === "jpeg" ? "image/jpeg" : `image/${dims.type}`;
  const { error: upErr } = await supabase.storage.from("platform-branding").upload(path, file, { contentType, upsert: false, cacheControl: "31536000" });
  if (upErr) return { ok: false, message: "تعذر رفع الشعار؛ بقي الشعار الحالي كما هو.", attempt };
  const { error } = await supabase.rpc("platform_set_logo", { p_path: path });
  if (error) {
    await supabase.storage.from("platform-branding").remove([path]);
    return { ok: false, message: `${rpcErrorMessage(error)} — بقي الشعار الحالي كما هو.`, attempt };
  }
  return done("تم حفظ شعار المنصة وتطبيقه.", attempt);
}

async function done(message: string, attempt: number): Promise<ActionState> {
  invalidatePlatformLogo();
  await invalidateMyContext();
  revalidatePath("/", "layout");
  return { ok: true, message, attempt };
}
