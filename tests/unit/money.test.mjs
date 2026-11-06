// المبالغ وضريبة القيمة المضافة (مطابقة لحساب shared_document في القاعدة)
import { test } from "node:test";
import assert from "node:assert/strict";

const m = await import("../../src/lib/money.ts");

test("الإجماليات والضريبة 15٪ والتقريب لهللتين", () => {
  assert.deepEqual(m.totals([{ quantity: 2, unit_price: 150 }, { quantity: 3, unit_price: "100" }, { quantity: 1, unit_price: 200 }], 15),
    { subtotal: 800, vatRate: 15, vat: 120, total: 920 });
  assert.deepEqual(m.totals([{ quantity: 3, unit_price: 33.33 }], 15), { subtotal: 99.99, vatRate: 15, vat: 15, total: 114.99 });
  assert.deepEqual(m.totals([{ quantity: 1.5, unit_price: 10 }], 0), { subtotal: 15, vatRate: 0, vat: 0, total: 15 });
  assert.deepEqual(m.totals([], 15), { subtotal: 0, vatRate: 15, vat: 0, total: 0 });
  assert.equal(m.lineTotal({ quantity: "2", unit_price: "12.5" }), 25);
});

test("قراءة المبالغ من الإدخال (أرقام عربية وفاصلة عربية)", () => {
  assert.equal(m.parseAmount("١٢٣٫٥"), 123.5);
  assert.equal(m.parseAmount(" 1500 "), 1500);
  assert.equal(m.parseAmount("10,25"), 10.25);
  assert.equal(m.parseAmount("-5"), null);
  assert.equal(m.parseAmount("1.234"), null);
  assert.equal(m.parseAmount("abc"), null);
  assert.equal(m.sar(1234.5), "1,234.50 ر.س");
});
