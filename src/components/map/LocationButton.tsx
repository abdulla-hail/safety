import { directionsHref, locationHref } from "@/lib/geo";

export interface SitePoint {
  id: string; name: string; latitude: number | null; longitude: number | null; archived_at?: string | null;
  /** نص الموقع كما أدخله المستخدم (رابط/إحداثيات/عنوان وطني) والعنوان المكتوب: بديل عند غياب النقطة */
  location_text?: string | null; address?: string | null; district?: string | null; city?: string | null;
}

const pill = "inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-soft/40 px-2.5 py-1 text-xs font-semibold text-brand-strong hover:bg-brand-soft";

/**
 * زر «الموقع»: يفتح موقع الفرع في خرائط Google مباشرة (والاتجاهات منه): بالنقطة المحددة، وإلا بنص الموقع كما أدخله المستخدم
 * (الرابط نفسه، أو البحث بالعنوان الوطني). عميل بعدة فروع: قائمة صغيرة بكل فرع له موقع.
 * يعمل دون JavaScript (details/summary) ويناسب الجوال حيث يفتح تطبيق الخرائط.
 */
export default function LocationButton({ sites }: { sites: SitePoint[] }) {
  const located = sites.filter((s) => !s.archived_at).map((s) => ({ ...s, href: locationHref(s), dir: directionsHref(s) })).filter((s) => s.href);
  if (located.length === 0) return <span className="text-xs text-slate-400">—</span>;
  if (located.length === 1) {
    return (
      <a href={located[0].href!} target="_blank" rel="noopener noreferrer" className={pill} title={`فتح «${located[0].name}» في خرائط Google`}>
        📍 الموقع
      </a>
    );
  }
  return (
    <details className="relative">
      <summary className={`${pill} cursor-pointer list-none`}>📍 الموقع ({located.length})</summary>
      <ul className="absolute end-0 z-10 mt-1 w-56 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-xs shadow-lg">
        {located.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <a href={s.href!} target="_blank" rel="noopener noreferrer" className="truncate font-semibold text-brand-strong hover:underline">{s.name}</a>
            {s.dir && <a href={s.dir} target="_blank" rel="noopener noreferrer" className="shrink-0 text-slate-500 hover:underline">اتجاهات</a>}
          </li>
        ))}
      </ul>
    </details>
  );
}
