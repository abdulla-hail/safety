/** أصناف Tailwind موحدة لعناصر الواجهة. الألوان من متغيرات globals.css (لون المنصة التفاعلي --brand). */

export const btn =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-ring)] focus-visible:ring-offset-1 " +
  "active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 icon-hover";
/** الزر الرئيسي: اللون #D98E04 بنص داكن واضح، ودرجات أغمق للتحويم والضغط */
export const btnPrimary = `${btn} bg-brand text-on-brand shadow-sm hover:bg-brand-hover hover:shadow active:bg-brand-active disabled:bg-brand-muted`;
/** الزر الثانوي: إطار محايد يتلوّن بلون المنصة عند التفاعل */
export const btnSecondary = `${btn} border border-slate-300 bg-white text-slate-700 hover:border-brand hover:bg-brand-soft hover:text-brand-strong active:bg-brand-muted`;
export const btnDanger = `${btn} bg-danger text-white hover:opacity-90 hover:shadow`;
export const btnDangerOutline = `${btn} border border-red-300 bg-white text-red-700 hover:border-red-400 hover:bg-red-50`;
export const btnGhost = `${btn} text-slate-600 hover:bg-brand-soft hover:text-brand-strong`;
export const btnSm = "!px-3 !py-1.5 !text-xs";

export const input =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 " +
  "hover:border-slate-400 focus:border-brand focus:ring-2 focus:ring-[var(--brand-ring)] disabled:bg-slate-100";
export const label = "mb-1.5 block text-sm font-semibold text-slate-700";
export const card = "rounded-xl border border-slate-200 bg-card shadow-sm transition-shadow duration-200";
export const cardHeader = "flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4";
export const cardTitle = "text-base font-bold text-foreground";
export const link = "font-semibold text-brand-strong underline-offset-4 transition-colors hover:text-brand-active hover:underline";
