// قراءة فقط: آخر نشاط في سجل التدقيق والهوية (للتمييز بين نشاط التطبيق وآثار الاختبارات). لا يطبع بيانات شخصية.
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
const audit = (await c.query("select action, created_at from public.company_audit_log order by created_at desc limit 6")).rows;
const branding = (await c.query("select count(*)::int n, max(created_at) last from public.company_branding_history")).rows[0];
await c.query("rollback");
await c.end();
console.log(JSON.stringify({ now: new Date().toISOString(), audit, branding }, null, 2));
