import Form from "next/form";
import Link from "next/link";
import { input, btnPrimary, btnGhost } from "@/components/ui/styles";
import { param, type SearchParams } from "@/lib/list";

export interface FilterField {
  name: string;
  label: string;
  type?: "select" | "date" | "text";
  options?: { value: string; label: string }[];
  placeholder?: string;
}

/** شريط بحث وتصفية يعمل بالرابط (GET) فيبقى عند إعادة التحميل ومشاركة الرابط. */
export default function FilterBar({
  action,
  searchParams,
  fields = [],
  searchPlaceholder = "بحث بالاسم أو الرقم المرجعي...",
  showArchive = true,
  hidden = [],
}: {
  action: string;
  searchParams: SearchParams;
  fields?: FilterField[];
  searchPlaceholder?: string;
  showArchive?: boolean;
  hidden?: string[];
}) {
  return (
    <Form action={action} className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-5 py-4">
      {hidden.map((h) => (
        <input key={h} type="hidden" name={h} defaultValue={param(searchParams, h)} />
      ))}
      <div className="min-w-48 flex-1">
        <label htmlFor="q" className="sr-only">بحث</label>
        <input id="q" name="q" type="search" defaultValue={param(searchParams, "q")} placeholder={searchPlaceholder} className={input} />
      </div>
      {fields.map((f) => (
        <div key={f.name} className="min-w-36">
          <label htmlFor={`f-${f.name}`} className="mb-1 block text-xs font-semibold text-slate-500">{f.label}</label>
          {f.type === "select" ? (
            <select id={`f-${f.name}`} name={f.name} defaultValue={param(searchParams, f.name)} className={input}>
              <option value="">الكل</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : (
            <input id={`f-${f.name}`} name={f.name} type={f.type ?? "text"} defaultValue={param(searchParams, f.name)}
                   placeholder={f.placeholder} className={input} />
          )}
        </div>
      ))}
      {showArchive && (
        <div className="min-w-32">
          <label htmlFor="f-archived" className="mb-1 block text-xs font-semibold text-slate-500">السجلات</label>
          <select id="f-archived" name="archived" defaultValue={param(searchParams, "archived") || "active"} className={input}>
            <option value="active">النشطة</option>
            <option value="archived">المؤرشفة</option>
            <option value="all">الكل</option>
          </select>
        </div>
      )}
      <button type="submit" className={btnPrimary}>تطبيق</button>
      <Link href={action} className={btnGhost}>مسح</Link>
    </Form>
  );
}
