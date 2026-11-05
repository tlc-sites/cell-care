import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261105010000_busan_staff.sql', import.meta.url), 'utf8');
const u = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 1 이흥배 목사, 2 황성수 사모, 3 다른 교역자, 4 셀리더(교역자 아님) · 11~16 부산 셀, 17 목록 없는 공동 셀, 18 분당 셀

test('부산 셀 담당 정리: 남장년·여장년은 담당 배정, 청년은 두 분 공동, 다른 교역자는 빠짐', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private; create schema report;
      create table public.profiles(id uuid primary key,name text,active boolean);
      insert into public.profiles values ('${u(1)}','이흥배 목사',true),('${u(2)}','황성수 사모',true),('${u(3)}','다른 전도사',true),('${u(4)}','셀리더',true);
      create table public.cells(id uuid primary key,name text,campus text,active boolean,staff_shared boolean,review_mode text);
      insert into public.cells values
        ('${u(11)}','부산 남장년1 셀','부산',true,true,'leadership'),('${u(12)}','부산 남장년2 셀','부산',true,true,'none'),
        ('${u(13)}','부산 여장년1 셀','부산',true,true,'leadership'),('${u(14)}','부산 여장년2 셀','부산',true,true,'leadership'),
        ('${u(15)}','부산 청년1 셀','부산',true,true,'leadership'),('${u(16)}','부산 청년2 셀','부산',true,true,'leadership'),
        ('${u(17)}','부산 새 셀','부산',true,true,'leadership'),('${u(18)}','분당 셀',null,true,false,'leadership');
      create table public.cell_leaders(cell_id uuid,user_id uuid,start_date date);
      insert into public.cell_leaders select id,'${u(4)}','2026-01-01' from public.cells;
      create table public.leadership_assignments(id uuid default gen_random_uuid(),cell_id uuid,leadership_user_id uuid,start_date date,end_date date);
      insert into public.leadership_assignments(cell_id,leadership_user_id,start_date) values ('${u(18)}','${u(3)}','2026-01-01');
      create function private.current_profile_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function private.app_today() returns date language sql as $$select '2026-11-05'::date$$;
      create function private.has_role(text) returns boolean language sql as $$select private.current_profile_id() in ('${u(1)}','${u(2)}','${u(3)}')$$;
      create table report.cellcare_report_reads(report_id uuid,profile_id uuid,last_read_at timestamptz);
      insert into report.cellcare_report_reads values ('${u(91)}','${u(1)}','2026-11-04'),('${u(92)}','${u(2)}','2026-11-04');
    `);
    await db.exec(migration);
    await db.exec(migration); // 다시 실행해도 안전(배정·목록이 두 번 들어가지 않음)

    const cells = (await db.query('select name,staff_shared,review_mode from public.cells order by name')).rows;
    assert.deepEqual(cells.filter(c => /남장년1|여장년/.test(c.name)).map(c => [c.staff_shared, c.review_mode]), Array(3).fill([false, 'leadership']));
    assert.deepEqual(cells.filter(c => /남장년2/.test(c.name)).map(c => [c.staff_shared, c.review_mode]), [[true, 'none']]);  // 교역자 셀은 그대로
    assert.ok(cells.filter(c => /청년|새 셀/.test(c.name)).every(c => c.staff_shared));
    const asg = (await db.query(`select c.name,a.leadership_user_id who,a.start_date::text s from public.leadership_assignments a join public.cells c on c.id=a.cell_id where c.campus='부산' order by 1`)).rows;
    assert.deepEqual(asg.map(a => [a.name, a.who, a.s]), [
      ['부산 남장년1 셀', u(1), '2026-11-02'], ['부산 여장년1 셀', u(2), '2026-11-02'], ['부산 여장년2 셀', u(2), '2026-11-02']]);

    const can = async (who, cell, d = null) => { await db.exec(`set test.actor='${u(who)}'`); return (await db.query('select private.is_cell_leadership($1,$2) v', [u(cell), d])).rows[0].v; };
    assert.deepEqual([await can(1, 11), await can(1, 13), await can(1, 15), await can(1, 16)], [true, false, true, true]);
    assert.deepEqual([await can(2, 11), await can(2, 14), await can(2, 15)], [false, true, true]);
    assert.deepEqual([await can(3, 11), await can(3, 15), await can(3, 17), await can(3, 18)], [false, false, true, true]);  // 목록 없는 공동 셀은 그대로
    assert.equal(await can(3, 12), true);  // 남장년2(교역자 셀)는 그대로 공동
    assert.equal(await can(1, 11, '2026-10-26'), false);  // 배정 전 주차는 날짜를 준 판단에서 빠짐
    assert.equal(await can(4, 15), false);  // 교역자 아님

    await db.exec(`set test.actor='${u(3)}'`);
    const names = (await db.query('select names from report.cellcare_shared_staff_list() order by cell_id')).rows.map(r => r.names);
    assert.deepEqual(names, ['이흥배 목사, 황성수 사모', '이흥배 목사, 황성수 사모']);
    assert.equal((await db.query('select report.cellcare_cell_staff($1) v', [u(15)])).rows[0].v, '이흥배 목사, 황성수 사모');
    assert.equal((await db.query('select report.cellcare_cell_staff($1) v', [u(17)])).rows[0].v, '교역자 공동');
    await db.exec(`set test.actor='${u(1)}'`);
    assert.deepEqual((await db.query(`select report_id from report.cellcare_my_report_reads(array['${u(91)}','${u(92)}']::uuid[])`)).rows.map(r => r.report_id), [u(91)]);
  } finally { await db.close(); }
});

test('부산 셀 이름이 하나로 찾아지지 않으면 아무것도 바꾸지 않음', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private; create schema report;
      create table public.profiles(id uuid primary key,name text,active boolean);
      insert into public.profiles values ('${u(1)}','이흥배 목사',true),('${u(2)}','황성수 사모',true);
      create table public.cells(id uuid primary key,name text,campus text,active boolean,staff_shared boolean,review_mode text);
      insert into public.cells values ('${u(11)}','부산 남장년1 셀','부산',true,true,'leadership');
      create table public.cell_leaders(cell_id uuid,user_id uuid,start_date date);
      create table public.leadership_assignments(id uuid default gen_random_uuid(),cell_id uuid,leadership_user_id uuid,start_date date,end_date date);
      create function private.current_profile_id() returns uuid language sql as $$select null::uuid$$;
      create function private.app_today() returns date language sql as $$select '2026-11-05'::date$$;
      create function private.has_role(text) returns boolean language sql as $$select false$$;
      create table report.cellcare_report_reads(report_id uuid,profile_id uuid,last_read_at timestamptz);
    `);
    await assert.rejects(db.exec(migration), /여장년1 셀을 하나로 찾지 못했습니다/);
    await db.exec('rollback');
    assert.equal((await db.query('select staff_shared from public.cells')).rows[0].staff_shared, true);
    assert.equal((await db.query('select count(*)::int n from public.leadership_assignments')).rows[0].n, 0);
  } finally { await db.close(); }
});
