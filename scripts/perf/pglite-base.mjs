// قاعدة PGlite محلية بكل الترحيلات المطبقة (+ مقترحات اختيارية) لاختبارات الأداء على بيانات اصطناعية. لا تتصل بأي قاعدة حية.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

/**
 * proposed: ترحيلات تُطبَّق بعد الأساس بالترتيب (من proposed/ أو migrations/ أينما وُجدت).
 * exclude: ترحيلات مطبّقة تُستثنى من الأساس (لقياس «قبل» ترحيل نُقل إلى migrations/).
 */
export async function pgliteBase(proposed = [], exclude = []) {
  const d = new PGlite();
  await d.exec(read("tests", "cgwn", "current-schema.sql"));
  await d.exec(read("tests", "cgwn", "storage-stub.sql"));
  const skip = new Set([...proposed, ...exclude]);
  for (const f of fs.readdirSync(path.join(root, "supabase", "migrations")).sort().filter((x) => !skip.has(x))) {
    await d.exec(read("supabase", "migrations", f).replace(/create extension if not exists pg_cron;[\s\S]*?end \$\$;/, ""));
  }
  for (const f of proposed) {
    const dir = fs.existsSync(path.join(root, "supabase", "proposed", f)) ? "proposed" : "migrations";
    await d.exec(read("supabase", dir, f));
  }
  return d;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const d = await pgliteBase();
  const r = await d.query(`select table_name, string_agg(column_name || ':' || udt_name, ', ' order by ordinal_position) cols
    from information_schema.columns where table_schema = 'public' and is_nullable = 'NO' and column_default is null
    and table_name = any($1) group by 1`, [process.argv.slice(2)]);
  for (const x of r.rows) console.log(x.table_name, "=>", x.cols);
  const c = await d.query(`select conrelid::regclass t, pg_get_constraintdef(oid) d from pg_constraint where contype = 'c' and conrelid::regclass::text = any($1)`, [process.argv.slice(2)]);
  for (const x of c.rows) console.log(x.t, x.d);
}
