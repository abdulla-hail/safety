import Form from "next/form";
import PrintToolbar from "@/components/print/PrintToolbar";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { barcodeSvgFill, deviceScanPath, qrSvg, siteUrl } from "@/lib/codes";
import { A4, LABEL_SIZES, resolveLabelSize } from "@/lib/label-sizes";
import { loadPrintDevices, MAX_PRINT_DEVICES, SCOPE_LABEL } from "@/lib/device-print";
import { param, type SearchParams } from "@/lib/list";

export const metadata = { title: "طباعة ملصقات الأجهزة | عين السلامة" };

/** حقول الملصق القابلة للاختيار (القيمة الافتراضية عند أول فتح) */
const FIELDS = [
  ["company", "اسم الشركة", true], ["customer", "اسم العميل", true], ["site", "الموقع", true],
  ["name", "اسم الجهاز", true], ["ref", "رقم الجهاز", true], ["token", "رمز الجهاز النصي", false],
] as const;
type Field = (typeof FIELDS)[number][0];
const CODES = [["qr", "رمز QR"], ["barcode", "باركود"], ["both", "QR وباركود"]] as const;

interface D {
  id: string; ref_no: string; name: string; qr_token: string; location_detail: string | null;
  customer: { name: string } | null; site: { name: string } | null;
}

export default async function LabelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("devices.print");
  const sp = await searchParams;
  const size = resolveLabelSize(param(sp, "size") || "a4-6");
  const copies = Math.min(10, Math.max(1, Number.parseInt(param(sp, "copies"), 10) || 1));
  const code = (CODES.some(([k]) => k === param(sp, "code")) ? param(sp, "code") : "qr") as (typeof CODES)[number][0];
  // عند إرسال نموذج الخيارات تُقرأ الخانات المحددة؛ وفي أول فتح تُستخدم القيم الافتراضية
  const custom = param(sp, "opts") === "1";
  const show = Object.fromEntries(FIELDS.map(([k, , def]) => [k, custom ? param(sp, `f_${k}`) === "1" : def])) as Record<Field, boolean>;
  const supabase = await createClient();

  const [{ list, total, truncated, scope }, { data: org }] = await Promise.all([
    loadPrintDevices<D>(supabase, ctx.orgId, sp, "id, ref_no, name, qr_token, location_detail, customer:customers(name), site:customer_sites(name)"),
    supabase.from("companies").select("name").eq("id", ctx.orgId).single(),
  ]);

  const base = await siteUrl();
  const labels = await Promise.all(list.flatMap((d) => Array.from({ length: copies }, async (_, i) => ({
    key: `${d.id}-${i}`, d,
    qr: code === "barcode" ? "" : await qrSvg(`${base}${deviceScanPath(d.qr_token)}`),
    bar: code === "qr" ? "" : barcodeSvgFill(d.qr_token),
  }))));

  const sheet = size.mode === "sheet";
  const perPage = sheet ? (size.cols ?? 1) * (size.rows ?? 1) : 1;
  const pages: (typeof labels)[] = [];
  for (let i = 0; i < labels.length; i += perPage) pages.push(labels.slice(i, i + perPage));

  // تخطيط رأسي للملصقات الكبيرة (مثل 92×88)، وأفقي للصغيرة
  const vertical = size.height >= 70;
  const pad = Math.max(1.5, Math.min(4, size.height * 0.06));
  const innerW = size.width - pad * 2;
  const innerH = size.height - pad * 2;
  const pt = Math.max(5.5, Math.min(11, size.height * (vertical ? 0.12 : 0.24)));
  // مساحة الرموز: QR مربع لا يقل عن 20مم في الملصقات الكبيرة؛ الباركود بارتفاع ثابت يكفي للمسح
  const barH = vertical ? 14 : Math.max(7, Math.min(12, size.height * 0.3));
  const qrMm = vertical
    ? Math.min(innerW * 0.68, innerH - (code === "both" ? barH + 2 : 0) - 30)
    : Math.min(innerH, size.width * 0.5);
  const gapX = size.gapX ?? 0;
  const gapY = size.gapY ?? 0;
  const gridW = (size.cols ?? 1) * size.width + ((size.cols ?? 1) - 1) * gapX;
  const gridH = (size.rows ?? 1) * size.height + ((size.rows ?? 1) - 1) * gapY;

  const css = `
    @page labels-sheet { size: A4; margin: 0; }
    @page labels-roll { size: ${size.width}mm ${size.height}mm; margin: 0; }
    .sheet-page { page: labels-sheet; width: ${A4.width}mm; height: ${A4.height - 1}mm; box-sizing: border-box; background: #fff;
      display: grid; place-content: center; margin: 0 auto 8mm; box-shadow: 0 2px 10px rgb(0 0 0 / .1); overflow: hidden; }
    .sheet-grid { display: grid; grid-template-columns: repeat(${size.cols ?? 1}, ${size.width}mm); grid-auto-rows: ${size.height}mm;
      column-gap: ${gapX}mm; row-gap: ${gapY}mm; width: ${gridW}mm; min-height: ${gridH}mm; align-content: start; }
    .roll-page { page: labels-roll; margin: 0 auto 6mm; width: ${size.width}mm; height: ${size.height}mm; }
    .label { width: ${size.width}mm; height: ${size.height}mm; padding: ${pad}mm; box-sizing: border-box; overflow: hidden;
      background: #fff; color: #000; break-inside: avoid; page-break-inside: avoid; outline: 0.25mm dashed #94a3b8;
      display: flex; gap: ${pad}mm; ${vertical ? "flex-direction: column; align-items: center; text-align: center;" : "align-items: center;"} }
    .label .codes { flex: none; display: flex; flex-direction: column; align-items: center; gap: 1.5mm; ${vertical ? "" : code === "qr" ? "" : "width: 100%;"} }
    .label .qr { width: ${qrMm}mm; height: ${qrMm}mm; }
    .label .qr svg { width: 100%; height: 100%; display: block; }
    .label .bar { width: ${vertical ? innerW * 0.92 : code === "qr" ? 0 : innerW}mm; height: ${barH}mm; }
    .label .bar svg { width: 100%; height: 100%; display: block; }
    .label .txt { min-width: 0; flex: 1; line-height: 1.25; overflow: hidden; display: flex; flex-direction: column; justify-content: center; ${vertical ? "width: 100%;" : ""} }
    .label .org { font-size: ${pt * 0.8}pt; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .label .nm { font-size: ${pt * 0.9}pt; font-weight: 700; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .label .ref { font-size: ${pt}pt; font-weight: 800; font-family: ui-monospace, monospace; direction: ltr; ${vertical ? "" : "text-align: right;"} }
    .label .tok { font-size: ${pt * 0.65}pt; font-family: ui-monospace, monospace; direction: ltr; letter-spacing: .05em; ${vertical ? "" : "text-align: right;"} }
    .label .sub { font-size: ${pt * 0.7}pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${!vertical && code !== "qr" ? ".label { flex-direction: column; align-items: stretch; } .label .codes { flex-direction: row; }" : ""}
    @media print {
      .labels-root { padding: 0 !important; }
      .sheet-page, .roll-page { margin: 0; box-shadow: none; break-after: page; page-break-after: always; }
      .sheet-page:last-child, .roll-page:last-child { break-after: auto; page-break-after: auto; }
      .label { outline: none; ${sheet ? "border: 0.2mm dashed #bbb;" : ""} }
    }`;

  const textFor = (d: D) => (
    <div className="txt">
      {show.company && org?.name && <p className="org">{org.name}</p>}
      {show.name && <p className="nm">{d.name}</p>}
      {show.ref && <p className="ref">{d.ref_no}</p>}
      {show.token && <p className="tok">{d.qr_token}</p>}
      {show.customer && d.customer && <p className="sub">{d.customer.name}</p>}
      {show.site && (d.site || d.location_detail) && <p className="sub">{[d.site?.name, d.location_detail].filter(Boolean).join(" — ")}</p>}
    </div>
  );

  return (
    <>
      <style>{css}</style>
      <PrintToolbar note={`${SCOPE_LABEL[scope.kind]}: ${list.length} جهاز × ${copies} = ${labels.length} ملصق في ${pages.length} صفحة — ${size.label}. في نافذة الطباعة: الهوامش «بدون» والمقياس 100%.`}>
        <Form action="/print/labels" className="flex flex-wrap items-center gap-2 text-sm">
          {Object.entries(scope.hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="opts" value="1" />
          <label htmlFor="size" className="text-slate-600">المقاس</label>
          <select id="size" name="size" defaultValue={LABEL_SIZES.some((s) => s.key === size.key) ? size.key : "a4-6"} className="rounded-lg border border-slate-300 px-2 py-1.5">
            {LABEL_SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <label htmlFor="code" className="text-slate-600">الرمز</label>
          <select id="code" name="code" defaultValue={code} className="rounded-lg border border-slate-300 px-2 py-1.5">
            {CODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label htmlFor="copies" className="text-slate-600">النسخ</label>
          <input id="copies" name="copies" type="number" min={1} max={10} defaultValue={copies} className="w-16 rounded-lg border border-slate-300 px-2 py-1.5" />
          <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-2 py-1">
            <legend className="sr-only">بيانات الملصق</legend>
            {FIELDS.map(([k, l]) => (
              <label key={k} className="flex items-center gap-1 text-slate-600">
                <input type="checkbox" name={`f_${k}`} value="1" defaultChecked={show[k]} /> {l}
              </label>
            ))}
          </fieldset>
          <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold">تحديث المعاينة</button>
        </Form>
        {truncated && <span className="text-xs font-semibold text-amber-700">النتائج {total} جهازًا؛ تُطبع أول {MAX_PRINT_DEVICES} فقط. ضيّق النطاق بالعميل أو الموقع.</span>}
      </PrintToolbar>
      {list.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-600">لم يتم تحديد أجهزة للطباعة، أو لا تملك صلاحية عرضها.</p>
      ) : (
        <div className="labels-root pb-10" dir="rtl">
          {pages.map((page, i) => (
            <section key={i} className={sheet ? "sheet-page" : "roll-page"} aria-label={`صفحة ${i + 1}`}>
              <div className={sheet ? "sheet-grid" : undefined}>
                {page.map(({ key, d, qr, bar }) => (
                  <div key={key} className="label">
                    <div className="codes">
                      {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label={`رمز QR للجهاز ${d.ref_no}`} />}
                      {bar && <div className="bar" dangerouslySetInnerHTML={{ __html: bar }} role="img" aria-label={`باركود الجهاز ${d.ref_no}`} />}
                    </div>
                    {textFor(d)}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
