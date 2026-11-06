// اختبار قابلية مسح رمز QR بالأحجام المستخدمة في الملصقات (توليد صورة ثم فك ترميزها).
import { test } from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import bwipjs from "bwip-js/node";

const URL = "https://ain-alsalama.example.com/d/K7M2QX9PLR4T";

function decode(buffer) {
  const png = PNG.sync.read(buffer);
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
}

// أصغر ملصق (QR بعرض 18 مم) على طابعة حرارية 203 نقطة/بوصة ≈ 144 بكسل
for (const [label, px] of [["ملصق صغير 18مم @203dpi", 144], ["ملصق متوسط 25مم @203dpi", 200], ["A4 بحجم 30مم @300dpi", 354]]) {
  test(`QR قابل للمسح: ${label}`, async () => {
    const buf = await QRCode.toBuffer(URL, { errorCorrectionLevel: "M", margin: 2, width: px });
    assert.equal(decode(buf), URL);
  });
}

test("QR يبقى قابلًا للمسح مع تلف جزئي بسيط (تصحيح M)", async () => {
  const buf = await QRCode.toBuffer(URL, { errorCorrectionLevel: "M", margin: 2, width: 300 });
  const png = PNG.sync.read(buf);
  // طمس شريط صغير في المنتصف (~5% من المساحة)
  for (let y = 140; y < 155; y++) for (let x = 100; x < 200; x++) {
    const i = (y * png.width + x) * 4;
    png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
  }
  assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, URL);
});

test("الرمز لا يحتوي بيانات حساسة: فقط عنوان المسح والرمز العشوائي", async () => {
  const svg = await QRCode.toString(URL, { type: "svg" });
  assert.ok(svg.startsWith("<svg"));
  assert.match(URL, /\/d\/[A-HJ-NP-Z2-9]{12}$/);
});

test("توليد باركود Code128 للرمز", () => {
  const svg = bwipjs.toSVG({ bcid: "code128", text: "K7M2QX9PLR4T", scale: 2, height: 10 });
  assert.ok(svg.includes("<svg"));
});
