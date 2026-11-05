import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261105000000_issue_scope_review_reads.sql', import.meta.url), 'utf8');
const u = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 1 교역자(사랑셀 담당), 2 다른 교역자, 9 담임 · 11 사랑셀, 12 다른 셀 · 41~44 보고서

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema private; create schema report;
    create function private.current_profile_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.is_senior() returns boolean language sql as $$select private.current_profile_id()='${u(9)}'::uuid$$;
    create function private.is_cell_leadership(p_cell uuid,d date default null) returns boolean language sql as $$
      select (private.current_profile_id(),p_cell) in (('${u(1)}'::uuid,'${u(11)}'::uuid),('${u(2)}'::uuid,'${u(12)}'::uuid))$$;
    create table public.cell_members(id uuid,cell_id uuid,name text,active boolean,deleted_at timestamptz,left_at date);
    insert into public.cell_members values
      (gen_random_uuid(),'${u(11)}','김 사랑',true,null,null),
      (gen_random_uuid(),'${u(11)}','박떠남',true,null,'2026-10-10'),
      (gen_random_uuid(),'${u(12)}','이다른',true,null,null);
    -- 운영 issue_board 대신: 동정 4건(내가 씀 / 내 셀원 이름 / 떠난 뒤 / 다른 셀) + 보고 1건. my_area는 동정 작성자가 나인지
    create function public.issue_board(p_weeks integer default 8,p_scope text default 'mine')
    returns table(source text,item_id uuid,on_date date,week_start date,cell_id uuid,cell_name text,resp_name text,person_id uuid,person_name text,
      category text,content text,attention boolean,related_member_id uuid,related_name text,relation_kind text,author_name text,my_area boolean,categories text[],campus text)
    language sql as $$
      select * from (values
        ('report','${u(31)}'::uuid,'2026-11-01'::date,'2026-11-01'::date,'${u(11)}'::uuid,'사랑셀','',null::uuid,'김 사랑','health','',false,null::uuid,null,null,'',true,array['health'],'분당'),
        ('note','${u(32)}'::uuid,'2026-11-01'::date,null::date,null::uuid,null,null,null::uuid,'아무개','health','',false,null::uuid,null,null,'',private.current_profile_id()='${u(1)}'::uuid,array['health'],'분당'),
        ('note','${u(33)}'::uuid,'2026-11-01'::date,null::date,null::uuid,null,null,null::uuid,'김사랑','health','',false,null::uuid,null,null,'',false,array['health'],'분당'),
        ('note','${u(34)}'::uuid,'2026-11-01'::date,null::date,null::uuid,null,null,null::uuid,'박떠남','health','',false,null::uuid,null,null,'',false,array['health'],'분당'),
        ('note','${u(35)}'::uuid,'2026-11-01'::date,null::date,null::uuid,null,null,null::uuid,'이다른','health','',false,null::uuid,null,null,'',false,array['health'],'분당')
      ) v$$;
    create table public.report_events(id bigserial,report_id uuid,actor_id uuid,action text,detail jsonb,created_at timestamptz);
    create table report.cellcare_senior_acks(kind text,target_id uuid,role text,profile_id uuid,acked_at timestamptz);
    create table report.cellcare_notification_items(id uuid default gen_random_uuid(),profile_id uuid,kind text,report_id uuid,created_at timestamptz,read_at timestamptz);
    insert into report.cellcare_notification_items(profile_id,kind,report_id,created_at) values
      ('${u(1)}','REPORT_SUBMITTED','${u(41)}','2026-10-30T10:00Z'),  -- 내가 그 뒤 확인 → 읽음
      ('${u(1)}','REPORT_SUBMITTED','${u(42)}','2026-10-30T10:00Z'),  -- 다른 교역자가 확인 → 그대로
      ('${u(1)}','REPORT_UPDATED','${u(43)}','2026-10-31T10:00Z'),    -- 다시 제출 전에 확인 → 그대로
      ('${u(9)}','REPORT_SUBMITTED','${u(44)}','2026-10-30T10:00Z'),  -- 담임이 「확인했습니다」 → 읽음
      ('${u(1)}','REPORT_SUBMITTED','${u(44)}','2026-10-30T10:00Z');  -- 담임 확인은 교역자 알림과 무관 → 그대로
    insert into public.report_events(report_id,actor_id,action,created_at) values
      ('${u(41)}','${u(1)}','reviewed','2026-10-31T09:00Z'),
      ('${u(42)}','${u(2)}','reviewed','2026-10-31T09:00Z'),
      ('${u(43)}','${u(1)}','reviewed','2026-10-30T12:00Z');
    insert into report.cellcare_senior_acks values ('report','${u(44)}','senior_pastor','${u(9)}','2026-10-31T09:00Z');
  `);
  return db;
}

test('「내 분파」 성도 동정은 내가 쓴 것과 내 셀원 이름만, 교회 전체·담임은 그대로', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    await db.exec(migration); // 다시 실행해도 안전
    const ids = async (scope) => (await db.query('select item_id from report.cellcare_issue_board(8,$1) order by item_id', [scope])).rows.map(r => r.item_id);
    await db.exec(`set test.actor='${u(1)}'`);
    assert.deepEqual(await ids('mine'), [u(31), u(32), u(33)]);  // 떠난 셀원(10/10 이전)·다른 셀 동정은 빠짐
    assert.deepEqual(await ids('all'), [u(31), u(32), u(33), u(34), u(35)]);
    await db.exec(`set test.actor='${u(2)}'`);
    assert.deepEqual(await ids('mine'), [u(31), u(35)]);
    await db.exec(`set test.actor='${u(9)}'`);
    assert.equal((await ids('mine')).length, 5);
  } finally { await db.close(); }
});

test('알림 뒤에 본인이 확인한 보고서의 제출 알림만 읽음으로 정리', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    const rows = (await db.query('select profile_id,report_id,read_at is not null r from report.cellcare_notification_items order by report_id,profile_id')).rows
      .map(x => [x.profile_id.slice(-2), x.report_id.slice(-2), x.r]);
    assert.deepEqual(rows, [['01', '41', true], ['01', '42', false], ['01', '43', false], ['01', '44', false], ['09', '44', true]]);
  } finally { await db.close(); }
});
