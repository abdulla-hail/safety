// اختبار حفظ رابط الدعوة عبر رحلة الدخول: يقبل مسارات صفحات الدعوة فقط ويرفض أي تحويل آخر.
import { test } from "node:test";
import assert from "node:assert/strict";

const { safeInvitePath, readCookiePath } = await import("../../src/lib/invite-next.ts");

test("مسار الدعوة: يقبل صفحتي الدعوة فقط", () => {
  const tok = "QZZXHIGiQzON70RCh8pSWtdg-kt93EgUuLBUlwVU59w";
  assert.equal(safeInvitePath(`/assistant-invite/${tok}`), `/assistant-invite/${tok}`);
  assert.equal(safeInvitePath(`/invite/${tok}`), `/invite/${tok}`);
  assert.equal(safeInvitePath("/dashboard"), null);
  assert.equal(safeInvitePath("//evil.example/assistant-invite/" + tok), null);
  assert.equal(safeInvitePath("https://evil.example/invite/" + tok), null);
  assert.equal(safeInvitePath(`/invite/${tok}?next=/x`), null);
  assert.equal(safeInvitePath("/invite/short"), null);
  assert.equal(safeInvitePath(null), null);
});

test("قيمة الكوكي: فك الترميز الآمن", () => {
  assert.equal(readCookiePath("%2Finvite%2Fabc"), "/invite/abc");
  assert.equal(readCookiePath("%E0%A4%A"), null);
  assert.equal(readCookiePath(undefined), null);
});
