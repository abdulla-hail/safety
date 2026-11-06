// قياس زمن الطلبات من هذا الجهاز إلى Supabase وإلى خادم التطوير (لا يطبع أي مفاتيح).
// الاستخدام: node scripts/perf/measure-supabase.mjs
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const h = { apikey: key, Authorization: `Bearer ${key}` };

async function time(label, fn, n = 5) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    try { await fn(); } catch { /* يُقاس الزمن حتى عند الخطأ */ }
    out.push(Math.round(performance.now() - t));
  }
  const sorted = [...out].sort((a, b) => a - b);
  console.log(`${label.padEnd(38)} min ${sorted[0]}ms · median ${sorted[Math.floor(n / 2)]}ms · max ${sorted[n - 1]}ms`);
}

await time("Supabase JWKS (getClaims أول مرة)", () => fetch(`${url}/auth/v1/.well-known/jwks.json`).then((r) => r.text()));
await time("Supabase REST select (anon)", () => fetch(`${url}/rest/v1/permission_definitions?select=key&limit=1`, { headers: h }).then((r) => r.text()));
await time("Supabase RPC get_my_context (anon)", () => fetch(`${url}/rest/v1/rpc/get_my_context`, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: "{}" }).then((r) => r.text()));
await time("Supabase auth/v1/user (getUser)", () => fetch(`${url}/auth/v1/user`, { headers: h }).then((r) => r.text()));
await time("localhost:3000/login (صفحة عامة)", () => fetch("http://localhost:3000/login").then((r) => r.text()));
await time("localhost:3000/dashboard (تحويل دون جلسة)", () => fetch("http://localhost:3000/dashboard", { redirect: "manual" }).then((r) => r.text()));
