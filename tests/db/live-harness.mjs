// اتصال بقاعدة Supabase الفعلية لاختبار السياسات داخل معاملة واحدة يُتراجع عنها دائمًا.
// لا يُحفظ أي سجل اختبار في قاعدة الإنتاج.
import pg from "pg";
import { pgConfig } from "../../scripts/db/env.mjs";

export async function createLiveDb() {
  const client = new pg.Client(pgConfig());
  await client.connect();
  await client.query("begin");
  let n = 0;
  const db = {
    live: true,
    query: (sql, params) => client.query(sql, params),
    exec: (sql) => client.query(sql),
    async transaction(fn) {
      const sp = `sp_${++n}`;
      await client.query(`savepoint ${sp}`);
      const tx = { query: (s, p) => client.query(s, p), exec: (s) => client.query(s) };
      try {
        const out = await fn(tx);
        await client.query(`release savepoint ${sp}`);
        return out;
      } catch (e) {
        await client.query(`rollback to savepoint ${sp}`);
        throw e;
      } finally {
        await client.query("reset role");
        await client.query("select set_config('request.jwt.claim.sub', '', false)");
      }
    },
    async close() {
      await client.query("rollback");
      await client.end();
    },
  };
  return db;
}
