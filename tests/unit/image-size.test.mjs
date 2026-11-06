// اختبار قراءة أبعاد الصور من الترويسة (PNG/JPEG/WebP) المستخدمة في التحقق من شعار المنصة.
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

const { imageDimensions } = await import("../../src/lib/image-size.ts");

function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("أبعاد PNG", () => {
  assert.deepEqual(imageDimensions(new Uint8Array(png(320, 120))), { width: 320, height: 120, type: "png" });
});

test("أبعاد JPEG من مقطع SOF0", () => {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  assert.deepEqual(imageDimensions(new Uint8Array([0xff, 0xd8, ...app0, ...sof])), { width: 200, height: 100, type: "jpeg" });
});

test("WebP VP8X وملف تالف", () => {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0); b.write("WEBP", 8); b.write("VP8X", 12);
  b[24] = 0xff; b[25] = 0x01; b[27] = 0x63; // 512 × 100
  assert.deepEqual(imageDimensions(new Uint8Array(b)), { width: 512, height: 100, type: "webp" });
  assert.equal(imageDimensions(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(imageDimensions(new TextEncoder().encode("<svg></svg>")), null);
});
