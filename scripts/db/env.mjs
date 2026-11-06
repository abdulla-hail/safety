// قراءة رابط قاعدة البيانات من .env.migrate.local دون طباعته.
import fs from "node:fs";
import path from "node:path";

export function readDatabaseUrl() {
  const file = path.resolve(process.cwd(), ".env.migrate.local");
  if (!fs.existsSync(file)) {
    throw new Error("الملف .env.migrate.local غير موجود. أضف DATABASE_URL=... إليه.");
  }
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("DATABASE_URL غير موجود في .env.migrate.local");
}

export function pgConfig() {
  return {
    connectionString: readDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  };
}
