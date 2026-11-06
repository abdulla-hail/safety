/** أبعاد صورة PNG أو JPEG أو WebP من ترويسة الملف (دون مكتبات). يعيد null لصيغة غير مدعومة أو ملف تالف. */
export function imageDimensions(buf: Uint8Array): { width: number; height: number; type: "png" | "jpeg" | "webp" } | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // PNG: التوقيع ثم IHDR
  if (buf.length >= 24 && dv.getUint32(0) === 0x89504e47 && dv.getUint32(12) === 0x49484452) {
    return { width: dv.getUint32(16), height: dv.getUint32(20), type: "png" };
  }
  // JPEG: البحث عن مقطع SOF
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7), type: "jpeg" };
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP ثم VP8 / VP8L / VP8X
  if (buf.length >= 30 && dv.getUint32(0) === 0x52494646 && dv.getUint32(8) === 0x57454250) {
    const chunk = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
    if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff, type: "webp" };
    if (chunk === "VP8L") {
      const b = dv.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, type: "webp" };
    }
    if (chunk === "VP8X") {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h, type: "webp" };
    }
  }
  return null;
}
