// مقارنة زمن الاستجابة بين خادم التطوير (المنفذ 3000، يشغّله المستخدم) ونسخة الإنتاج المحلية (next start على 3100 بعد npm run build).
// يشغّل نسخة الإنتاج مؤقتًا ثم يوقفها. الصفحات العامة وتحويل الصفحات المحمية دون جلسة فقط (لا بيانات دخول).
// الاستخدام: npm run build ثم node scripts/perf/measure-prod-vs-dev.mjs
import { spawn } from "node:child_process";
import path from "node:path";

const PROD = 3100;
const PATHS = ["/login", "/dashboard", "/invite/not-a-real-token"];
const N = 10;

async function time(base, p) {
  const out = [];
  let bytes = 0, status = 0;
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    const r = await fetch(base + p, { redirect: "manual" });
    const body = await r.arrayBuffer();
    out.push(performance.now() - t);
    bytes = body.byteLength; status = r.status;
  }
  const s = [...out].sort((a, b) => a - b);
  return { status, first: Math.round(out[0]), median: Math.round(s[Math.floor(N / 2)]), p90: Math.round(s[Math.floor(N * 0.9)]), kb: Math.round(bytes / 1024) };
}
async function up(base) { try { await fetch(base + "/login", { redirect: "manual" }); return true; } catch { return false; } }

const next = path.join("node_modules", "next", "dist", "bin", "next");
const srv = spawn(process.execPath, [next, "start", "-p", String(PROD)], { stdio: "ignore", env: { ...process.env, NODE_ENV: "production" } });
try {
  for (let i = 0; i < 60 && !(await up(`http://localhost:${PROD}`)); i++) await new Promise((r) => setTimeout(r, 500));
  const res = {};
  for (const [name, base] of [["dev :3000", "http://localhost:3000"], ["prod :3100", `http://localhost:${PROD}`]]) {
    if (!(await up(base))) { res[name] = "غير متاح"; continue; }
    res[name] = {};
    for (const p of PATHS) res[name][p] = await time(base, p);
  }
  console.log(JSON.stringify(res, null, 1));
} finally {
  srv.kill();
}
