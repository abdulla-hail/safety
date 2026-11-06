// بيئة اختبار قاعدة البيانات: Postgres مضمّن (PGlite) + محاكاة Supabase + الترحيلات الفعلية.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
// تصميم organizations السابق (لا ينطبق على مشروع cgwn؛ محفوظ للمرجع فقط)
const migrationsDir = path.join(root, "supabase", "legacy-organizations-design");

export function migrationFiles() {
  return fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => path.join(migrationsDir, f));
}

export async function createTestDb({ seed } = {}) {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(import.meta.dirname, "supabase-stub.sql"), "utf8"));
  if (seed) await seed(db);
  for (const file of migrationFiles()) {
    try {
      await db.exec(fs.readFileSync(file, "utf8"));
    } catch (e) {
      e.message = `${path.basename(file)}: ${e.message}`;
      throw e;
    }
  }
  return db;
}

/** تنفيذ استعلام بصفة مستخدم مصادق (role=authenticated) مع auth.uid() = userId. */
export async function asUser(db, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await tx.exec(userId ? "set local role authenticated" : "set local role anon");
    return fn(tx);
  });
}

export async function createUser(db, email, name = email.split("@")[0]) {
  const { rows } = await db.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3) returning id",
    [crypto.randomUUID(), email, JSON.stringify({ full_name: name })],
  );
  return rows[0].id;
}

/** يُرجع رمز خطأ Postgres أو null إذا نجح التنفيذ. */
export async function errorCode(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e.code ?? e.message;
  }
}
