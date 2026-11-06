// Compares the project ref in DATABASE_URL with NEXT_PUBLIC_SUPABASE_URL without printing secrets.
import fs from "node:fs";
import pg from "pg";
const read = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const app = read(".env.local");
const mig = read(".env.migrate.local");
const appRef = new URL(app.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
let u;
try { u = new URL(mig.DATABASE_URL); } catch { console.log("DATABASE_URL is not a valid URL"); process.exit(1); }
const user = decodeURIComponent(u.username);
const host = u.hostname;
// pooler: user = postgres.<ref>; direct: host = db.<ref>.supabase.co
const dbRef = user.includes(".") ? user.split(".").slice(1).join(".") : host.startsWith("db.") ? host.split(".")[1] : null;
const mask = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-3)} (len ${s.length})` : "none");
console.log("app project ref :", mask(appRef));
console.log("db  project ref :", mask(dbRef));
console.log("refs match      :", dbRef === appRef);
console.log("connection type :", host.includes("pooler") ? `pooler (${host.split(".")[0]}…), port ${u.port}` : host.startsWith("db.") ? `direct, port ${u.port}` : "other");
console.log("db user role    :", user.split(".")[0]);
const c = new pg.Client({ connectionString: mig.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("set default_transaction_read_only = on");
const r = (await c.query("select current_database() db, current_user, version(), (select setting from pg_settings where name='server_version') v, pg_is_in_recovery() replica")).rows[0];
console.log("connected       :", r.db, "as", r.current_user, "| PG", r.v, "| read replica:", r.replica);
const s = (await c.query("select exists(select 1 from information_schema.tables where table_schema='public' and table_name='organizations') orgs, exists(select 1 from pg_namespace where nspname='app_private') app_private, exists(select 1 from pg_namespace where nspname='auth') auth")).rows[0];
console.log("has public.organizations:", s.orgs, "| app_private exists:", s.app_private, "| auth schema:", s.auth);
await c.end();
