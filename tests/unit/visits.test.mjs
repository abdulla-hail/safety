// قواعد تنفيذ الزيارة في الواجهة (مطابقة لترحيل 20261106000100): التحقق من البند، القطع، ملخص الإغلاق،
// حساب الموعد القادم (مطابق لـ compute_next_due)، تصنيف «عملي»، والخط الزمني.
import { test } from "node:test";
import assert from "node:assert/strict";

const v = await import("../../src/lib/visits.ts");
const T = "2026-10-27";
const opt = { visitType: "periodic", canReschedule: false, today: T };

test("البند المفحوص يحتاج النتيجة والحالة بعد الفحص؛ النتيجة منفصلة عن الحالة التشغيلية", () => {
  assert.deepEqual(Object.keys(v.validateItem({ inspection_status: "inspected" }, opt)).sort(), ["result", "status_after"]);
  assert.deepEqual(v.validateItem({ inspection_status: "inspected", result: "fail", status_after: "operational" }, opt), {});
  assert.deepEqual(v.validateItem({ inspection_status: "pending" }, opt), {}, "المسودة تُحفظ ناقصة");
  assert.ok(v.validateItem({ inspection_status: "inspected", result: "ok", status_after: "operational" }, opt).result);
});

test("تعذر الفحص / غير موجود يتطلبان سببًا", () => {
  assert.ok(v.validateItem({ inspection_status: "unable" }, opt).skip_reason);
  assert.ok(v.validateItem({ inspection_status: "not_found", skip_reason: "  " }, opt).skip_reason);
  assert.deepEqual(v.validateItem({ inspection_status: "not_found", skip_reason: "أُزيل من الموقع" }, opt), {});
});

test("المتابعة تحتاج مسؤولًا وتاريخًا غير ماضٍ", () => {
  const e = v.validateItem({ inspection_status: "inspected", result: "fail", status_after: "faulty", follow_up_needed: true }, opt);
  assert.ok(e.follow_up_technician_id && e.follow_up_due);
  assert.ok(v.validateItem({ inspection_status: "pending", follow_up_needed: true, follow_up_technician_id: "x", follow_up_due: "2026-10-26" }, opt).follow_up_due);
  assert.deepEqual(v.validateItem({ inspection_status: "pending", follow_up_needed: true, follow_up_technician_id: "x", follow_up_due: T }, opt), {});
});

test("تعديل الموعد القادم: بصلاحية وسبب وفي الدورية فقط وبعد اليوم", () => {
  const i = { inspection_status: "inspected", result: "pass", status_after: "operational", next_due_override: "2027-01-01", next_due_reason: "طلب العميل" };
  assert.ok(v.validateItem(i, opt).next_due_override, "بلا صلاحية");
  assert.deepEqual(v.validateItem(i, { ...opt, canReschedule: true }), {});
  assert.ok(v.validateItem(i, { ...opt, visitType: "emergency", canReschedule: true }).next_due_override, "الطارئة لا تغيّر الموعد");
  assert.ok(v.validateItem({ ...i, next_due_override: T }, { ...opt, canReschedule: true }).next_due_override);
  assert.ok(v.validateItem({ ...i, next_due_reason: "" }, { ...opt, canReschedule: true }).next_due_reason);
});

test("القطع والمواد: سطر لكل بند مع كمية اختيارية", () => {
  assert.deepEqual(v.parseParts("حلقة إحكام × 2\nمسحوق 6 كجم x 1 كيس\nملصق فحص\n"), [
    { name: "حلقة إحكام", qty: 2, unit: null }, { name: "مسحوق 6 كجم", qty: 1, unit: "كيس" }, { name: "ملصق فحص", qty: null, unit: null }]);
  assert.deepEqual(v.parseParts(""), []);
  assert.equal(v.parseParts(Array.from({ length: 51 }, (_, i) => `ق${i}`).join("\n")), "invalid");
  assert.equal(v.partsText([{ name: "حلقة", qty: 2, unit: "قطعة" }, { name: "ملصق", qty: null }]), "حلقة × 2 قطعة\nملصق");
});

test("ملخص الإغلاق: غير المفحوص لا يُحتسب، والنتيجة مطابقة لـ visit_close", () => {
  const I = (s, r = null, f = false) => ({ inspection_status: s, result: r, follow_up_needed: f });
  let s = v.closeSummary([I("inspected", "pass"), I("pending")]);
  assert.equal(s.canCloseNormally, false);
  assert.equal(s.outcome, "incomplete");
  assert.equal(s.inspected, 1);
  assert.equal(v.closeSummary([I("inspected", "pass"), I("inspected", "pass")]).outcome, "completed");
  assert.equal(v.closeSummary([I("inspected", "pass"), I("unable")]).outcome, "completed_with_issues");
  assert.equal(v.closeSummary([I("inspected", "pass_with_notes")]).outcome, "completed_with_issues");
  s = v.closeSummary([I("inspected", "fail", true), I("not_found")]);
  assert.equal(s.outcome, "follow_up_required");
  assert.equal(s.fails, 1);
  assert.equal(v.closeSummary([]).canCloseNormally, false);
  assert.equal(v.progressPercent(1, 3), 33);
  assert.equal(v.progressPercent(0, 0), 0);
});

test("الموعد القادم من تاريخ التنفيذ الفعلي وفترة الخطة، مع قصّ نهاية الشهر", () => {
  assert.equal(v.addMonthsISO("2026-01-31", 1), "2026-02-28");
  assert.equal(v.addMonthsISO("2028-01-31", 1), "2028-02-29");
  assert.equal(v.addMonthsISO("2026-11-15", 3), "2027-02-15");
  const base = { start: "2026-01-10", months: 3, days: null, policy: "from_completion", currentDue: "2026-04-10" };
  assert.equal(v.computeNextDue({ ...base, done: "2026-04-20" }), "2026-07-20", "من تاريخ الإنجاز (متأخر)");
  assert.equal(v.computeNextDue({ ...base, done: null }), "2026-04-10", "بداية الجدول");
  // الثابتة على تقويم البداية: الإنجاز المتأخر لا يزيح الجدول، والمبكر يغطي الاستحقاق الحالي
  assert.equal(v.computeNextDue({ ...base, policy: "fixed", done: "2026-04-20" }), "2026-07-10");
  assert.equal(v.computeNextDue({ ...base, policy: "fixed", done: "2026-04-01" }), "2026-07-10");
  assert.equal(v.computeNextDue({ ...base, months: null, days: 90, done: "2026-04-20" }), "2026-07-19", "الأجهزة القديمة بالأيام");
  assert.equal(v.computeNextDue({ ...base, months: null, days: null, done: "2026-04-20" }), null, "بلا خطة لا يُخترع موعد");
});

test("تصنيف «عملي»: متأخر / اليوم / قادم / لاحق، والتجميع حسب الموقع", () => {
  assert.equal(v.bucketFor("2026-10-20", T, 14), "overdue");
  assert.equal(v.bucketFor(T, T, 14), "today");
  assert.equal(v.bucketFor("2026-11-10", T, 14), "upcoming");
  assert.equal(v.bucketFor("2026-11-11", T, 14), "later");
  assert.equal(v.bucketFor(null, T, 14), "none");
  const g = v.groupDueBySite([
    { site_id: "A", next_maintenance_at: "2026-11-01" }, { site_id: "B", next_maintenance_at: "2026-10-01" },
    { site_id: "B", next_maintenance_at: T }, { site_id: "C", next_maintenance_at: "2027-06-01" }, { site_id: null, next_maintenance_at: "2026-10-01" },
  ], { D: 2 }, T, 14);
  assert.deepEqual(g.map((s) => s.siteId), ["B", "A", "D"], "الموقع المتأخر أولًا، ولا يظهر ما ليس فيه عمل");
  assert.deepEqual([g[0].overdue, g[0].today, g[0].earliest], [1, 1, "2026-10-01"]);
  assert.equal(g[2].openFaults, 2);
  assert.ok(v.matchesQuery(" ext ", "Fire EXTinguisher") && !v.matchesQuery("x", "abc", null));
  assert.equal(v.periodStart("30", T), "2026-09-27");
  assert.equal(v.periodStart("all", T), null);
});

test("الخط الزمني: الأحدث أولًا، ودمج المصادر دون فقد", () => {
  const t = v.mergeTimeline(
    [{ at: "2026-10-01T10:00:00Z", kind: "maintenance", title: "فحص" }],
    [{ at: "2026-10-05T08:00:00Z", kind: "transfer", title: "نقل" }, { at: "2026-10-01T10:00:00Z", kind: "due", title: "موعد" }],
  );
  assert.deepEqual(t.map((e) => e.title), ["نقل", "فحص", "موعد"]);
});
