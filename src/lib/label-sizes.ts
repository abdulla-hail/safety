/** مقاسات الملصقات (بالمليمتر). «roll» ملصق واحد لكل صفحة لطابعات الملصقات، و«sheet» شبكة على ورق A4. */
export interface LabelSize {
  key: string;
  label: string;
  width: number;
  height: number;
  mode: "roll" | "sheet";
  /** لورق A4: عدد الأعمدة والصفوف والمسافات بين الملصقات (مم) */
  cols?: number;
  rows?: number;
  gapX?: number;
  gapY?: number;
}

/** أبعاد A4 الفعلية بالمليمتر */
export const A4 = { width: 210, height: 297 } as const;

export const LABEL_SIZES: LabelSize[] = [
  // 2 عمود × 3 صفوف: هامش 10مم ومسافة قص 6مم → (190−6)/2 = 92مم عرضًا، (277−12)/3 ≈ 88مم ارتفاعًا
  { key: "a4-6", label: "ورق A4 — 6 ملصقات كبيرة (92×88 مم)", width: 92, height: 88, mode: "sheet", cols: 2, rows: 3, gapX: 6, gapY: 6 },
  { key: "40x25", label: "صغير 40×25 مم (طابعة ملصقات)", width: 40, height: 25, mode: "roll" },
  { key: "50x30", label: "متوسط 50×30 مم (طابعة ملصقات)", width: 50, height: 30, mode: "roll" },
  { key: "70x50", label: "كبير 70×50 مم (طابعة ملصقات)", width: 70, height: 50, mode: "roll" },
  { key: "100x60", label: "كبير جدًا 100×60 مم (طابعة ملصقات)", width: 100, height: 60, mode: "roll" },
  { key: "a4-24", label: "ورق A4 — 24 ملصقًا (70×37 مم)", width: 70, height: 37, mode: "sheet", cols: 3, rows: 8 },
  { key: "a4-12", label: "ورق A4 — 12 ملصقًا (105×48 مم)", width: 105, height: 48, mode: "sheet", cols: 2, rows: 6 },
];

/** مقاس مخصص بصيغة custom-WxH (مثل custom-60x40) ضمن حدود آمنة */
export function resolveLabelSize(key: string): LabelSize {
  const found = LABEL_SIZES.find((s) => s.key === key);
  if (found) return found;
  const m = key.match(/^custom-(\d{2,3})x(\d{2,3})$/);
  if (m) {
    const w = Math.min(150, Math.max(25, Number(m[1])));
    const h = Math.min(150, Math.max(15, Number(m[2])));
    return { key, label: `مخصص ${w}×${h} مم`, width: w, height: h, mode: "roll" };
  }
  return LABEL_SIZES[1];
}
