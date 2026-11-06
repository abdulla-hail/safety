// قياس كلفة فتح اتصال جديد (DNS + TCP + TLS) مقابل إعادة استخدام اتصال مفتوح مع Supabase.
// الاستخدام: node scripts/perf/measure-connections.mjs
import fs from "node:fs";
import https from "node:https";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const target = new URL(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/permission_definitions?select=key&limit=1`);
const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };

function get(agent) {
  return new Promise((resolve, reject) => {
    const t = performance.now();
    const timing = {};
    const req = https.get(target, { headers, agent }, (res) => { res.resume(); res.on("end", () => resolve({ total: Math.round(performance.now() - t), ...timing })); });
    req.on("socket", (s) => {
      if (!s.connecting) return; // اتصال معاد استخدامه
      s.once("lookup", () => { timing.dns = Math.round(performance.now() - t); });
      s.once("connect", () => { timing.tcp = Math.round(performance.now() - t); });
      s.once("secureConnect", () => { timing.tls = Math.round(performance.now() - t); });
    });
    req.on("error", reject);
  });
}

const cold = [];
for (let i = 0; i < 4; i++) cold.push(await get(new https.Agent({ keepAlive: false })));
const warmAgent = new https.Agent({ keepAlive: true });
await get(warmAgent);
const warm = [];
for (let i = 0; i < 4; i++) warm.push((await get(warmAgent)).total);
console.log(JSON.stringify({ new_connection: cold, reused_connection_ms: warm }));
warmAgent.destroy();
