// كلفة الطلبات المتتابعة مقابل دفعة متوازية إلى Supabase (بالمفتاح العام؛ RLS تعيد نتائج فارغة، والزمن هو زمن الجولة).
// الاستخدام: node scripts/perf/measure-parallel.mjs
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const h = { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}` };
const TABLES = ["customers", "devices", "visits", "work_orders", "device_faults", "customer_sites", "maintenance_records", "notifications", "technicians", "safety_systems"];
const get = (t) => fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${t}?select=id&limit=1`, { headers: h }).then((r) => r.text());

await get("customers"); // فتح الاتصال
const med = (a) => Math.round([...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]);
const one = [], seq3 = [], par10 = [];
for (let i = 0; i < 5; i++) {
  let t = performance.now(); await get("devices"); one.push(performance.now() - t);
  t = performance.now(); for (const x of TABLES.slice(0, 3)) await get(x); seq3.push(performance.now() - t);
  t = performance.now(); await Promise.all(TABLES.map(get)); par10.push(performance.now() - t);
}
console.log(`طلب واحد: ${med(one)}ms · 3 طلبات متتابعة: ${med(seq3)}ms · 10 طلبات متوازية: ${med(par10)}ms (الوسيط من 5)`);
