/** قراءات الفحص: «الاسم = القيمة» (أو «الاسم: القيمة») في كل سطر ⇒ كائن يُحفظ في سجل الصيانة غير القابل للتعديل. */
export function parseReadings(text: string): Record<string, string> | "invalid" {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 30) return "invalid";
  for (const l of lines) {
    const i = l.search(/[=:]/);
    if (i < 1) return "invalid";
    const k = l.slice(0, i).trim().slice(0, 80), v = l.slice(i + 1).trim().slice(0, 200);
    if (!k || !v) return "invalid";
    out[k] = v;
  }
  return out;
}
