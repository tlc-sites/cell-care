import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261107000000_delete_draft_report.sql', import.meta.url), 'utf8');
const migration2 = await readFile(new URL('../supabase/migrations/20261107010000_delete_draft_report_events.sql', import.meta.url), 'utf8');
const u = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 1 셀리더, 2 다른 셀리더 · 31 작성 중(제출 0회), 32 고치는 중(제출 1회), 33 제출됨, 34 막는 기록이 붙은 작성 중

test('작성 중 셀보고서: 쓸 수 있는 분이 한 번도 제출 안 한 것만 지우고, 딸린 기록도 함께 지워진다', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private;
      create table public.weekly_reports(id uuid primary key,cell_id uuid,week_start date,status text,submission_no int,version int);
      create table public.attendance(report_id uuid references public.weekly_reports(id) on delete cascade,member_id uuid,status text);
      create table public.blocking_rows(report_id uuid references public.weekly_reports(id));
      create table public.report_events(report_id uuid references public.weekly_reports(id),actor_id uuid,action text,detail jsonb);
      create function private.current_profile_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function private.can_write_report(uuid,date) returns boolean language sql as $$select private.current_profile_id()='${u(1)}'::uuid$$;
      insert into public.weekly_reports values
        ('${u(31)}','${u(11)}','2026-10-19','draft',0,3),
        ('${u(32)}','${u(11)}','2026-10-12','draft',1,5),
        ('${u(33)}','${u(11)}','2026-10-05','submitted',1,4),
        ('${u(34)}','${u(11)}','2026-09-28','draft',0,1);
      insert into public.attendance values('${u(31)}','${u(51)}','present'),('${u(33)}','${u(51)}','present');
      insert into public.blocking_rows values('${u(34)}');
      insert into public.report_events values('${u(31)}','${u(1)}','created',null),('${u(31)}','${u(1)}','saved','{"v":2}'),('${u(33)}','${u(1)}','submitted',null),('${u(34)}','${u(1)}','created',null);
    `);
    await db.exec(migration);
    await db.exec(migration); // 다시 실행해도 안전
    await db.exec(migration2); await db.exec(migration2);
    const actor = n => db.exec(`set test.actor='${u(n)}'`);
    const del = id => db.query('select report.cellcare_delete_draft_report($1)', [id]);
    const exists = async id => (await db.query('select 1 from public.weekly_reports where id=$1', [id])).rows.length === 1;

    await actor(2);
    await assert.rejects(del(u(31)), /권한이 없습니다/);
    assert.ok(await exists(u(31)));

    await actor(1);
    await assert.rejects(del(u(32)), /한 번도 제출하지 않은/);
    await assert.rejects(del(u(33)), /한 번도 제출하지 않은/);
    await assert.rejects(del(u('99')), /권한이 없습니다/); // 없는 보고서

    await del(u(31));
    assert.equal(await exists(u(31)), false);
    assert.equal((await db.query('select count(*)::int n from public.attendance')).rows[0].n, 1); // 다른 보고서 출석은 그대로
    const log = (await db.query('select deleted_by,week_start::text w,snapshot->>\'status\' s from report.cellcare_deleted_reports where report_id=$1', [u(31)])).rows[0];
    assert.deepEqual(log, { deleted_by: u(1), w: '2026-10-19', s: 'draft' });
    // 막던 이력(report_events)은 기록표에 옮겨 담고 그 보고서 것만 지운다
    const evs = (await db.query('select events from report.cellcare_deleted_reports where report_id=$1', [u(31)])).rows[0].events;
    assert.deepEqual(evs.map(e => e.action).sort(), ['created', 'saved']);
    assert.equal((await db.query('select count(*)::int n from public.report_events where report_id=$1', [u(31)])).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from public.report_events')).rows[0].n, 2);

    // 지우지 못하게 막는 기록이 있으면 아무것도 지우지 않고(기록도 남기지 않고) 알려 준다
    await assert.rejects(del(u(34)), /blocking_rows/);
    assert.ok(await exists(u(34)));
    assert.equal((await db.query('select count(*)::int n from public.report_events where report_id=$1', [u(34)])).rows[0].n, 1); // 이력도 그대로
    assert.equal((await db.query('select count(*)::int n from report.cellcare_deleted_reports where report_id=$1', [u(34)])).rows[0].n, 0);
    for (const r of ['anon', 'authenticated']) {
      const g = (await db.query(`select has_table_privilege('${r}','report.cellcare_deleted_reports','select') g`)).rows[0].g;
      assert.equal(g, false);
    }
    assert.equal((await db.query(`select has_function_privilege('anon','report.cellcare_delete_draft_report(uuid)','execute') g`)).rows[0].g, false);
  } finally { await db.close(); }
});
