/** المبالغ: بنود بكمية وسعر وحدة، وضريبة القيمة المضافة (15٪ أو بلا ضريبة)؛ التقريب لهللتين كما في القاعدة (round(x, 2)). */
export interface PricedLine { quantity: number | string; unit_price: number | string }

const num = (v: number | string) => (typeof v === "number" ? v : Number.parseFloat(v)) || 0;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineTotal(l: PricedLine): number {
  return round2(num(l.quantity) * num(l.unit_price));
}

export function totals(lines: PricedLine[], vatRate: number) {
  const subtotal = round2(lines.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0));
  const vat = round2((subtotal * vatRate) / 100);
  return { subtotal, vatRate, vat, total: round2(subtotal + vat) };
}

const fmt = new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** مبلغ بالريال بأرقام لاتينية: 1,234.50 ر.س */
export function sar(n: number | string): string {
  return `${fmt.format(num(n))} ر.س`;
}

/** قراءة رقم من إدخال المستخدم (يقبل الأرقام العربية والفاصلة العشرية العربية) */
export function parseAmount(v: string): number | null {
  const s = v.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[٫,]/g, ".").replace(/\s/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number.parseFloat(s);
}
