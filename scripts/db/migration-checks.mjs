// تحققات تطبيق الترحيل وتجربة التراجع، مشتركة بين apply-cgwn.mjs (القاعدة الحية) والاختبارات المحلية (PGlite)،
// فيُختبر محليًا نفس الكود الذي يحرس التطبيق الحي.
//
// q(sql, params) → rows ، exec(sql) لتنفيذ ملف SQL كامل. إدارة المعاملة (begin/commit/rollback) على المستدعي.
//
// التغييرات المقصودة على صفوف قائمة تُعلن في ملف الترحيل بسطر:
//   -- @expect-change <table>(<col>, <col>): السبب
// فتُستثنى تلك الأعمدة وحدها من فحص «الصفوف القائمة لم تتغير» (وبقية أعمدة الجدول تبقى محروسة)، ويُعرض عدد الصفوف المتغيرة.
// فحص التراجع يبقى صارمًا على كل الأعمدة الأصلية: يجب أن يعيد التراجع القيم المقصودة كما كانت بالضبط.

export function expectedChanges(migrationSql) {
  const out = {};
  for (const m of migrationSql.matchAll(/^--\s*@expect-change\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gim)) {
    out[m[1]] = [...new Set([...(out[m[1]] ?? []), ...m[2].split(",").map((s) => s.trim()).filter(Boolean)])];
  }
  return out;
}

export async function runMigrationChecks({ q, exec, migration, rollback, dryRun }) {
  const checks = [];
  const check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });

  // مفتاح الصف: المفتاح الأساسي الفعلي للجدول (id أو غيره، مركبًا أو مفردًا)، فتُميَّز الصفوف القائمة عن الجديدة
  const pkCache = {};
  async function pkExpr(t) {
    if (!(t in pkCache)) {
      const cols = (await q(`select a.attname c from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
        where i.indrelid = ('public."' || $1 || '"')::regclass and i.indisprimary order by array_position(i.indkey, a.attnum)`, [t])).map((r) => r.c);
      pkCache[t] = cols.length ? `jsonb_build_array(${cols.map((c) => `"${c}"`).join(", ")})::text` : null;
    }
    return pkCache[t];
  }
  /** بصمة الصفوف التي كانت موجودة قبل الترحيل، على أعمدة محددة فقط؛ الصفوف الجديدة والأعمدة المضافة لا تُحسب */
  async function dataPrint(tables, columns, idsBefore) {
    const out = {};
    for (const t of tables) {
      const cols = columns[t];
      const pk = await pkExpr(t);
      const filter = pk && idsBefore?.[t] ? `where ${pk} = any($1)` : "";
      const obj = cols.length ? `jsonb_build_object(${cols.map((col) => `'${col}', "${col}"`).join(", ")})` : `'{}'::jsonb`;
      const r = (await q(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') h
        from (select ${obj} x from public."${t}" ${filter}) s`, filter ? [idsBefore[t]] : undefined))[0];
      out[t] = `${r.n}:${r.h}`;
    }
    return out;
  }
  async function ids(tables) {
    const out = {};
    for (const t of tables) {
      const pk = await pkExpr(t);
      if (pk) out[t] = (await q(`select ${pk} i from public."${t}"`)).map((r) => r.i);
    }
    return out;
  }
  /** بصمة كل صف قائم على حدة (للعد الدقيق للصفوف التي غيّرها الترحيل عمدًا) */
  async function rowPrints(t, cols, idsBefore) {
    const pk = await pkExpr(t);
    if (!pk || !idsBefore[t]) return new Map();
    const rows = await q(`select ${pk} k, md5(jsonb_build_object(${cols.map((col) => `'${col}', "${col}"`).join(", ")})::text) h
      from public."${t}" where ${pk} = any($1)`, [idsBefore[t]]);
    return new Map(rows.map((r) => [r.k, r.h]));
  }
  async function structure() {
    return {
      policies: await q(`select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies where schemaname in ('public','storage') order by 1,2,3`),
      grants: await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') order by 1,2,3`),
      constraints: await q(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace order by 1,2`),
      functions: await q(`select n.nspname, p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by 1,2`),
      columns: await q(`select table_name, column_name, udt_name from information_schema.columns where table_schema='public' order by 1,2`),
      triggers: await q(`select tgrelid::regclass::text t, tgname, tgenabled from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace) order by 1,2`),
      publication: await q(`select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1,2`),
    };
  }

  const expected = expectedChanges(migration);
  const existing = (await q(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1`)).map((r) => r.relname);
  for (const [t, cols] of Object.entries(expected)) {
    check(`التغيير المعلن يخص جدولًا قائمًا: ${t}(${cols.join(", ")})`, existing.includes(t));
  }
  const columnsBefore = {};
  for (const t of existing) columnsBefore[t] = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).map((r) => r.column_name);
  for (const [t, cols] of Object.entries(expected)) {
    const missing = cols.filter((c) => !(columnsBefore[t] ?? []).includes(c));
    check(`أعمدة التغيير المعلن موجودة في ${t}`, missing.length === 0, missing.join(","));
  }
  // الأعمدة المحروسة بعد الترحيل: كل الأعمدة الأصلية عدا المعلن تغييرها عمدًا
  const guarded = Object.fromEntries(existing.map((t) => [t, columnsBefore[t].filter((c) => !(expected[t] ?? []).includes(c))]));
  const idsBefore = await ids(existing);
  const before = await dataPrint(existing, columnsBefore, idsBefore);
  const beforeGuarded = await dataPrint(existing, guarded, idsBefore);
  const beforeRows = {};
  for (const t of Object.keys(expected)) if (existing.includes(t)) beforeRows[t] = await rowPrints(t, columnsBefore[t], idsBefore);
  const beforeStructure = await structure();

  await exec(migration);

  const after = await dataPrint(existing, guarded, idsBefore);
  for (const t of existing) {
    const added = idsBefore[t] ? (await q(`select count(*)::int n from public."${t}"`))[0].n - idsBefore[t].length : 0;
    const note = expected[t] ? ` · عدا الأعمدة المعلنة (${expected[t].join(", ")})` : "";
    check(`الصفوف القائمة في ${t} لم تتغير${note}`, after[t] === beforeGuarded[t], `${before[t].split(":")[0]} صف قائم${added ? ` · ${added} صف جديد` : ""}`);
  }
  for (const t of Object.keys(beforeRows)) {
    const now = await rowPrints(t, columnsBefore[t], idsBefore);
    let changed = 0;
    for (const [k, h] of beforeRows[t]) if (now.get(k) !== h) changed++;
    check(`تغيير مقصود في ${t} (${expected[t].join(", ")})`, now.size === beforeRows[t].size, `${changed} صف تغيّر عمدًا من ${beforeRows[t].size}`);
  }
  const created = (await q(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'`)).filter((r) => !existing.includes(r.relname));
  check("RLS مفعّل على كل جدول جديد", created.every((r) => r.relrowsecurity), created.filter((r) => !r.relrowsecurity).map((r) => r.relname).join(","));
  const anon = await q(`select distinct table_name from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name = any($1)`, [created.map((r) => r.relname)]);
  check("لا صلاحيات لـ anon على الجداول الجديدة", anon.length === 0, anon.map((r) => r.table_name).join(","));
  const writes = await q(`select table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')`);
  check("لا TRUNCATE/REFERENCES/TRIGGER للواجهة", writes.length === 0, JSON.stringify(writes.slice(0, 5)));
  const noPath = await q(`select n.nspname||'.'||p.proname f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','app_private') and p.prosecdef and not coalesce(p.proconfig::text, '') like '%search_path%'`);
  check("كل دوال SECURITY DEFINER بمسار بحث محدد", noPath.length === 0, noPath.map((r) => r.f).join(","));
  const anonFns = await q(`select n.nspname||'.'||p.proname f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname = 'app_private' and has_function_privilege('anon', p.oid, 'execute')`);
  check("لا دوال app_private قابلة للاستدعاء من anon", anonFns.length === 0, anonFns.map((r) => r.f).join(","));
  const internal = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
    and p.proname in ('next_ref','run_maintenance_alerts_for','run_all_maintenance_alerts','notify','seed_default_catalog')
    and has_function_privilege('authenticated', p.oid, 'execute')`);
  check("الدوال الداخلية الحساسة غير قابلة للاستدعاء من المسجلين", internal.length === 0, internal.map((r) => r.proname).join(","));
  const safety = await q(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'safety\\_%'`);
  check("دوال safety_* لم تُحذف", safety[0].n === beforeStructure.functions.filter((f) => f.nspname === "public" && f.proname.startsWith("safety_")).length);

  if (dryRun) {
    await exec(rollback);
    const restoredData = await dataPrint(existing, columnsBefore, idsBefore);
    const diff = existing.filter((t) => restoredData[t] !== before[t]);
    check("ملف التراجع يعيد الصفوف القائمة كما كانت (كل الأعمدة الأصلية)", diff.length === 0, diff.join(","));
    const restored = await structure();
    for (const k of Object.keys(beforeStructure)) {
      check(`ملف التراجع يعيد ${k} كما كانت`, JSON.stringify(restored[k]) === JSON.stringify(beforeStructure[k]));
    }
  }
  return checks;
}
