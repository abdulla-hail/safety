// اختبار عرض فترة الصيانة وحالة الاستحقاق (مطابقة لـ maintenance_due_status في القاعدة) وقراءة قراءات الفحص.
import { test } from "node:test";
import assert from "node:assert/strict";

const { intervalLabel, dueStatus, addDaysISO, todayISO } = await import("../../src/lib/format.ts");
const { parseReadings } = await import("../../src/lib/readings.ts");

test("فترة الصيانة: الأشهر للأجهزة الجديدة والأيام للقديمة", () => {
  assert.equal(intervalLabel(1, null), "كل شهر");
  assert.equal(intervalLabel(2, null), "كل شهرين");
  assert.equal(intervalLabel(3, 90), "كل 3 أشهر");
  assert.equal(intervalLabel(12, null), "كل 12 شهرًا");
  assert.equal(intervalLabel(null, 90), "كل 90 يوم");
  assert.equal(intervalLabel(null, null), "—");
});

test("حالة الاستحقاق: متأخر / مستحق اليوم / قريب / قادم / بلا جدول", () => {
  const t = todayISO();
  assert.equal(dueStatus(addDaysISO(t, -1), 14), "overdue");
  assert.equal(dueStatus(t, 14), "due");
  assert.equal(dueStatus(addDaysISO(t, 14), 14), "due_soon");
  assert.equal(dueStatus(addDaysISO(t, 15), 14), "upcoming");
  assert.equal(dueStatus(addDaysISO(t, 5), 3), "upcoming");
  assert.equal(dueStatus(null, 14), "none");
});

test("قراءات الفحص: سطر لكل قراءة، ورفض الصيغ غير الصالحة", () => {
  assert.deepEqual(parseReadings("الضغط = 12 بار\nالوزن: 6 كجم\n\n"), { "الضغط": "12 بار", "الوزن": "6 كجم" });
  assert.deepEqual(parseReadings(""), {});
  assert.equal(parseReadings("بلا فاصل"), "invalid");
  assert.equal(parseReadings("= قيمة"), "invalid");
  assert.equal(parseReadings("اسم ="), "invalid");
  assert.equal(parseReadings(Array.from({ length: 31 }, (_, i) => `ق${i} = ${i}`).join("\n")), "invalid");
});
