import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261103000000_reopen_reviewed_report.sql', import.meta.url), 'utf8');
const u = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 1 셀리더(사랑셀), 2 다른 셀리더, 3 교역자(확인한 분) · 31 확인 끝난 보고서, 32 확인 대기 보고서, 33 고치는 중 보고서

test('확인 끝난 보고서도 셀리더가 다시 고칠 수 있고, 다시 확인 대기로 돌아간다', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private;
      create table public.weekly_reports(id uuid primary key,cell_id uuid,week_start date,status text,review_status text,submission_no int,
        reviewed_at timestamptz,reviewed_by uuid,version int,updated_at timestamptz);
      create table public.report_events(report_id uuid,actor_id uuid,action text,detail jsonb);
      create function private.current_profile_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function private.can_write_report(uuid,date) returns boolean language sql as $$select private.current_profile_id()='${u(1)}'::uuid$$;
      create function private.log_event(p_report uuid,p_action text,p_detail jsonb default null) returns void language sql as $$
        insert into public.report_events values(p_report,private.current_profile_id(),p_action,p_detail)$$;
      insert into public.weekly_reports values
        ('${u(31)}','${u(11)}','2026-10-18','submitted','reviewed',1,'2026-10-20T10:00:00Z','${u(3)}',5,null),
        ('${u(32)}','${u(11)}','2026-10-25','submitted','pending',2,null,null,3,null),
        ('${u(33)}','${u(11)}','2026-11-01','draft','pending',0,null,null,1,null);
    `);
    await db.exec(migration);
    await db.exec(migration); // 다시 실행해도 안전
    const actor = n => db.exec(`set test.actor='${u(n)}'`);
    const reopen = id => db.query('select report.cellcare_reopen_report($1) as v', [id]);
    const row = async id => (await db.query('select status,review_status,reviewed_at,reviewed_by,version from public.weekly_reports where id=$1', [id])).rows[0];

    await actor(2);
    await assert.rejects(reopen(u(31)), /권한이 없습니다/);
    assert.equal((await row(u(31))).status, 'submitted');

    await actor(1);
    assert.equal((await reopen(u(31))).rows[0].v, 6);
    assert.deepEqual(await row(u(31)), { status: 'draft', review_status: 'pending', reviewed_at: null, reviewed_by: null, version: 6 });
    const ev = (await db.query("select detail from public.report_events where report_id=$1 and action='reopened'", [u(31)])).rows[0].detail;
    assert.equal(ev.was_reviewed, true);
    assert.equal(ev.reviewed_by, u(3));

    // 확인 대기 보고서는 예전과 같이 상태만 고치는 중으로
    assert.equal((await reopen(u(32))).rows[0].v, 4);
    assert.equal((await row(u(32))).review_status, 'pending');
    await assert.rejects(reopen(u(33)), /이미 고치는 중/);
  } finally { await db.close(); }
});
