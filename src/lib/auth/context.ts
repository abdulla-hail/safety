import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/permissions";
import { platformLogoUrl } from "@/lib/platform-branding";

export const ACTIVE_ORG_COOKIE = "ays_org";

/** عضوية المستخدم في شركة (أسماء الحقول داخلية في التطبيق؛ تُملأ من company_memberships/companies). */
export interface Membership {
  member_id: string;
  organization_id: string;
  organization_name: string;
  organization_ref: string | null;
  organization_status: "pending" | "approved" | "rejected" | "suspended";
  company_status: string;
  member_status: string;
  role: string;
  is_primary: boolean;
  /** مدير في الشركة (company_manager): المدير الأساسي أو مدير إضافي */
  is_owner: boolean;
  /** يدير الفريق والدعوات (team.manage؛ الفنيون للمديرين، والمديرون للمدير الأساسي فقط) */
  can_manage_team: boolean;
  job_roles: string[];
  expires_at: string | null;
  is_expired: boolean;
  primary_color: string;
  secondary_color: string;
  logo_path: string | null;
  permissions: Permission[];
}

export interface SessionUser {
  id: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
}

export interface AppContext {
  user: SessionUser;
  isPlatformAdmin: boolean;
  memberships: Membership[];
  /** العضوية الفعّالة المختارة (شركة نشطة + عضوية نشطة) أو null. */
  active: Membership | null;
  permissions: Set<string>;
  unreadNotifications: number;
  /** صفة إدارة المنصة: المالك الأساسي، أو مساعد مالك بصلاحيات محددة (منفصلة عن صلاحيات الشركات) */
  platformRole: "owner" | "assistant" | null;
  platformPermissions: Set<string>;
  /** شعار المنصة المرفوع (رابط عام بإصدار يتغير مع كل حفظ) أو null للافتراضي */
  platformLogoUrl: string | null;
}

export type PlatformPermission =
  | "platform.companies.view" | "platform.companies.create" | "platform.companies.update"
  | "platform.companies.status" | "platform.companies.invitations" | "platform.companies.delete" | "platform.branding";

export function isUsable(m: Membership) {
  return m.organization_status === "approved" && m.member_status === "active" && !m.is_expired;
}

const COMPANY_STATUS: Record<string, Membership["organization_status"]> = {
  active: "approved",
  pending: "pending",
  suspended: "suspended",
  archived: "suspended",
};

/** دور العضوية ← مفتاح الدور الوظيفي المستخدم في التسميات */
const ROLE_KEY: Record<string, string> = {
  company_manager: "manager",
  supervisor: "supervisor",
  technician: "technician",
  accountant: "accountant",
  storekeeper: "storekeeper",
};

interface RawMembership {
  member_id: string; company_id: string; company_name: string; company_ref: string | null; company_status: string;
  role: string; status: string; is_primary: boolean; permissions: string[];
  primary_color: string | null; secondary_color: string | null; logo_path: string | null;
}

type RawContext = {
  is_platform_admin?: boolean; unread_notifications?: number; memberships?: RawMembership[];
  platform_role?: "owner" | "assistant" | null; platform_permissions?: string[];
  platform_logo?: { path: string | null; updated_at: string | null } | null;
};

/**
 * ذاكرة قصيرة لنتيجة get_my_context لكل جلسة (المفتاح: المستخدم + معرّف الجلسة الموقّع في الرمز).
 * كل طلب إلى Supabase يستغرق ~400 مللي ثانية من الخادم (القاعدة في سيول)، والسياق كان طلبًا إضافيًا
 * يسبق بيانات كل صفحة. الذاكرة تخص عرض الواجهة فقط: كل قراءة وكتابة تمر بـ RLS ودوال القاعدة
 * التي تتحقق من العضوية والصلاحيات لحظيًا، فتأخر تحديث القائمة ثوانيَ لا يمنح أي وصول فعلي.
 */
const CONTEXT_TTL_MS = 30_000;
/** بعد TTL وحتى هذا العمر: يُعرض السياق الأخير فورًا ويُحدَّث في الخلفية (لا انتظار) */
const CONTEXT_SWR_MS = 5 * 60_000;
/** أقصى عمر لسياق قديم يُستخدم فقط عند تعذر الاتصال مؤقتًا */
const CONTEXT_STALE_MS = 10 * 60_000;

export class ContextUnavailableError extends Error {
  constructor() {
    super("تعذر تحميل بيانات حسابك وصلاحياتك مؤقتًا بسبب انقطاع الاتصال بقاعدة البيانات. أعد المحاولة.");
    this.name = "ContextUnavailableError";
  }
}
const contextCache = new Map<string, { at: number; raw: RawContext }>();
/** طلب get_my_context الجاري لكل جلسة: الطلبات المتزامنة (الصفحة وطلباتها الموازية) تشترك في استدعاء واحد */
const inflight = new Map<string, Promise<{ data: unknown; error: { code?: string } | null }>>();
/** إلغاء الاستعلام لانتهاء المهلة أو انتظار قفل: إعادة المحاولة فورًا تنتظر القفل نفسه مرة أخرى (≈ 8 ثوانٍ إضافية) */
const isTimeout = (code?: string) => code === "57014" || code === "55P03";

/** يُستدعى بعد أي عملية تغيّر عضويات/صلاحيات/إشعارات المستخدم الحالي */
export async function invalidateMyContext() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (sub) for (const k of contextCache.keys()) if (k.startsWith(`${sub}:`)) contextCache.delete(k);
  // مفتاح جديد لـ React.cache حتى لا يعيد إعادةُ العرض بعد العملية (في الطلب نفسه) السياقَ القديم المحفوظ لهذا الطلب
  contextGeneration++;
}
let contextGeneration = 0;

/**
 * يقرأ الجلسة والعضويات مرة واحدة لكل طلب.
 * - رمز الجلسة يُتحقق من توقيعه (getClaims بمفاتيح ES256 المنشورة للمشروع) دون طلب شبكي في كل مرة.
 * - كل بيانات السياق (المالك، العضويات، الصلاحيات الفعلية، عدد الإشعارات) من get_my_context في طلب واحد؛
 *   الدالة تعتمد على auth.uid() من الرمز الموثّق، لا على أي معرّف يرسله المتصفح.
 */
export const getContext = (): Promise<AppContext | null> => loadContext(contextGeneration);

// الوسيط مفتاح للذاكرة فقط (يتغير بعد إبطال السياق)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const loadContext = cache(async (_generation: number): Promise<AppContext | null> => {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (error || !claims?.sub) return null;

  const key = `${claims.sub}:${String(claims.session_id ?? "")}`;
  const hit = contextCache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  const fetchOnce = () => {
    let p = inflight.get(key);
    if (!p) {
      p = Promise.resolve(supabase.rpc("get_my_context")).then((r) => ({ data: r.data, error: r.error }))
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  };
  let raw: RawContext;
  if (hit && age < CONTEXT_TTL_MS) {
    raw = hit.raw;
  } else if (hit && age < CONTEXT_SWR_MS) {
    // عرض فوري بالسياق الأخير مع تحديثه في الخلفية: كانت كل صفحة بعد 30 ثانية تنتظر جولة كاملة (~350 مللي ثانية)
    // قبل أي بيانات. الطلب التالي يرى السياق المحدَّث؛ والقاعدة (RLS والدوال) تتحقق لحظيًا من كل قراءة وكتابة.
    raw = hit.raw;
    void fetchOnce().then((r) => {
      if (!r.error && r.data) contextCache.set(key, { at: Date.now(), raw: r.data as RawContext });
    }, () => {});
  } else {
    // فشل جلب السياق (انقطاع شبكة، أو انتظار قفل أثناء ترحيل فيُلغى الاستعلام 57014) لا يعني «لا صلاحيات»:
    // كان يُعامل كسياق فارغ فتظهر «ليست لديك صلاحية» زورًا. نعيد المحاولة مرة، ثم نستخدم آخر سياق معروف
    // لهذه الجلسة (القاعدة تتحقق من كل عملية على أي حال)، وإلا نرمي خطأ اتصال صريحًا.
    // إن انتهت مهلة الاستعلام وكان لدينا سياق حديث للجلسة نفسها (ضمن 10 دقائق) نستخدمه فورًا بدل انتظار قفل ثانٍ؛
    // إعادة المحاولة تبقى لأخطاء الشبكة العابرة أو عند عدم وجود سياق سابق.
    let res = await fetchOnce();
    const staleOk = !!hit && Date.now() - hit.at < CONTEXT_STALE_MS;
    if (res.error && !(staleOk && isTimeout(res.error.code))) {
      console.error("get_my_context failed (retrying):", res.error.code);
      res = await fetchOnce();
    }
    if (res.error || !res.data) {
      console.error("get_my_context failed:", res.error?.code ?? "empty");
      if (staleOk) raw = hit!.raw;
      else throw new ContextUnavailableError();
    } else {
      raw = res.data as RawContext;
      if (contextCache.size > 2000) contextCache.clear();
      contextCache.set(key, { at: Date.now(), raw });
    }
  }

  const memberships: Membership[] = (raw.memberships ?? []).map((r) => ({
    member_id: r.member_id,
    organization_id: r.company_id,
    organization_name: r.company_name,
    organization_ref: r.company_ref,
    organization_status: COMPANY_STATUS[r.company_status] ?? "pending",
    company_status: r.company_status,
    member_status: r.status,
    role: r.role,
    is_primary: r.is_primary === true,
    is_owner: r.role === "company_manager",
    // المدير الأساسي دائمًا (وقبل ترحيل 20261112000100 لا توجد team.manage، وكل المديرين أساسيون)
    can_manage_team: r.role === "company_manager" && (r.is_primary === true || (r.permissions ?? []).includes("team.manage")),
    job_roles: [ROLE_KEY[r.role] ?? r.role],
    expires_at: null,
    is_expired: false,
    primary_color: r.primary_color ?? "#1e3a5f",
    secondary_color: r.secondary_color ?? "#d98e04",
    logo_path: r.logo_path,
    permissions: (r.permissions ?? []) as Permission[],
  }));

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const usable = memberships.filter(isUsable);
  const active = usable.find((m) => m.organization_id === preferred) ?? usable[0] ?? null;

  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const email = typeof claims.email === "string" ? claims.email : null;
  return {
    user: {
      id: claims.sub,
      email,
      name: String(meta.full_name ?? meta.name ?? email ?? "مستخدم"),
      avatarUrl: typeof meta.avatar_url === "string" ? meta.avatar_url : null,
    },
    isPlatformAdmin: raw.is_platform_admin === true,
    memberships,
    active,
    permissions: new Set(active?.permissions ?? []),
    unreadNotifications: Number(raw.unread_notifications ?? 0),
    platformRole: raw.is_platform_admin === true ? "owner" : raw.platform_role === "assistant" ? "assistant" : null,
    platformPermissions: new Set(raw.platform_permissions ?? []),
    platformLogoUrl: platformLogoUrl(raw.platform_logo?.path, raw.platform_logo?.updated_at),
  };
});

/**
 * الصفحة الأولى لصاحب صفة إدارة المنصة حسب صلاحياته الفعلية: المساعد لا يُحوَّل لصفحة لا يملك صلاحيتها
 * (ولا لصفحة الانضمام لشركة)؛ المساعد بلا صلاحية عرض الشركات يبدأ من الإعدادات أو الإشعارات.
 */
export function platformHome(ctx: Pick<AppContext, "platformRole" | "platformPermissions">): string {
  if (ctx.platformRole === "owner" || ctx.platformPermissions.has("platform.companies.view")) return "/platform-admin";
  if (ctx.platformPermissions.has("platform.branding")) return "/platform-admin/settings";
  return "/notifications";
}

/** يتطلب صفة إدارة المنصة (مالك أو مساعد) وصلاحية منصة محددة؛ وإلا يحوّل. القاعدة تتحقق مجددًا في كل عملية. */
export async function requirePlatform(perm: PlatformPermission): Promise<AppContext> {
  const ctx = await requireUser();
  if (!ctx.platformPermissions.has(perm)) {
    // مساعد بلا هذه الصلاحية: إلى صفحته الأولى المسموحة إن كانت غير هذه، وإلا «لا صلاحية»
    const home = ctx.platformRole ? platformHome(ctx) : null;
    redirect(home && home !== "/platform-admin" ? home : "/forbidden");
  }
  return ctx;
}

/** فحص أولي داخل Server Actions لصلاحية منصة (القاعدة هي المرجع النهائي) */
export async function platformForAction(perm: PlatformPermission): Promise<AppContext | null> {
  const ctx = await getContext();
  return ctx?.platformPermissions.has(perm) ? ctx : null;
}

/** يتطلب جلسة؛ وإلا يحوّل لتسجيل الدخول. */
export async function requireUser(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export interface OrgContext extends AppContext {
  active: Membership;
  orgId: string;
  can: (perm: Permission) => boolean;
  canAny: (...perms: Permission[]) => boolean;
}

/** يتطلب عضوية فعّالة في شركة نشطة، واختياريًا صلاحية (أو أيًا من صلاحيات). */
export async function requireOrg(...anyOf: Permission[]): Promise<OrgContext> {
  const ctx = await requireUser();
  if (!ctx.active) redirect(ctx.platformRole ? platformHome(ctx) : "/onboarding");
  const can = (p: Permission) => ctx.permissions.has(p);
  const canAny = (...ps: Permission[]) => ps.some(can);
  if (anyOf.length > 0 && !canAny(...anyOf)) redirect("/forbidden");
  return { ...ctx, active: ctx.active, orgId: ctx.active.organization_id, can, canAny };
}

/** للتحقق داخل Server Actions دون تحويل: يعيد null إن لم تتوفر الصلاحية. */
export async function orgForAction(...anyOf: Permission[]): Promise<OrgContext | null> {
  const ctx = await getContext();
  if (!ctx?.active) return null;
  const can = (p: Permission) => ctx.permissions.has(p);
  const canAny = (...ps: Permission[]) => ps.some(can);
  if (anyOf.length > 0 && !canAny(...anyOf)) return null;
  return { ...ctx, active: ctx.active, orgId: ctx.active.organization_id, can, canAny };
}
