import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * تشفير أسرار الشركات المخزنة في القاعدة (كلمة مرور SMTP) بمفتاح الخادم MAIL_ENCRYPTION_KEY (AES-256-GCM).
 * القاعدة لا ترى إلا النص المشفر؛ من دون المفتاح لا يمكن استرجاع كلمة المرور. تغيير المفتاح يتطلب إعادة إدخال كلمات المرور.
 */
function key(): Buffer | null {
  const raw = process.env.MAIL_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) return null;
  return createHash("sha256").update(raw).digest();
}

export const secretsConfigured = () => key() !== null;

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw new Error("MAIL_ENCRYPTION_KEY غير مضبوط");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

export function decryptSecret(enc: string | null | undefined): string | null {
  const k = key();
  if (!k || !enc) return null;
  const [v, iv, tag, data] = enc.split(":");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
