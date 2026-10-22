import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const base = await readFile(new URL('../supabase/migrations/20261021010000_notifications_replies.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261022000000_report_talk_and_note_names.sql', import.meta.url), 'utf8');
const u = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 1 셀리더, 2 담당 교역자, 3 다른 교역자(보고서는 읽을 수 있음), 4 권한 없는 사용자
// 31 이번 주 제출 보고서, 32 같은 셀의 다른 주 보고서, 33 작성 중 보고서

test('보고서 대화: 해당 주차 보고서에만 붙고, 셀리더·담당 교역자만 쓰며 상대방에게 알림이 간다', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private;
      create table public.profiles(id uuid primary key,auth_user_id uuid,name text,active boolean);
      create table public.push_subscriptions(profile_id uuid,endpoint text,p256dh text,auth text,lang text);
      create table public.senior_comments(id uuid primary key,report_id uuid,target text,author_id uuid,deleted_at timestamptz,content text,created_at timestamptz default now());
      create table public.pastoral_note_comments(id uuid primary key,note_id uuid,author_id uuid,deleted_at timestamptz,content text,created_at timestamptz default now());
      create table public.msg_participants(thread_id uuid,profile_id uuid);
      create table public.msg_posts(id uuid,thread_id uuid,author_id uuid,body text,created_at timestamptz);
      create table public.announcements(id uuid,title text,body text,author_id uuid,created_at timestamptz,deleted_at timestamptz);
      create table public.cells(id uuid primary key,name text);
      create table public.weekly_reports(id uuid,cell_id uuid,week_start date,created_by uuid,submitted_by uuid,reviewer_user_id uuid,status text,submission_no integer,review_mode text,submitted_at timestamptz);
      create table public.cell_leaders(cell_id uuid,user_id uuid,start_date date,end_date date);
      create table public.leadership_assignments(cell_id uuid,leadership_user_id uuid,start_date date,end_date date);
      create table public.pastoral_notes(id uuid,author_id uuid,visibility text,person_name text,content text,prayer text,created_at timestamptz,active boolean default true);
      create function private.current_profile_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function private.is_admin() returns boolean language sql as $$select false$$;
      create function private.app_today() returns date language sql as $$select date '2026-10-22'$$;
      create function private.is_senior() returns boolean language sql as $$select false$$;
      create function private.has_role(text) returns boolean language sql as $$select false$$;
      create function private.is_cell_leadership(uuid) returns boolean language sql as $$select private.current_profile_id()='${u(2)}'::uuid$$;
      create function private.can_read_report(uuid) returns boolean language sql as $$select private.current_profile_id() in ('${u(1)}'::uuid,'${u(2)}'::uuid,'${u(3)}'::uuid)$$;
      create function private.can_see_senior_comment(uuid,text) returns boolean language sql as $$select false$$;
      create function private.can_read_pastoral_note(uuid) returns boolean language sql as $$select private.current_profile_id()='${u(2)}'::uuid$$;
      insert into public.profiles values ${[1, 2, 3, 4].map(n => `('${u(n)}','${u(n + 10)}','Demo ${n}',true)`).join(',')};
      insert into public.cells values('${u(20)}','은혜셀');
      insert into public.cell_leaders values('${u(20)}','${u(1)}','2026-01-01',null);
      insert into public.leadership_assignments values('${u(20)}','${u(2)}','2026-01-01',null);
      insert into public.weekly_reports values
        ('${u(31)}','${u(20)}','2026-10-19','${u(1)}','${u(1)}',null,'submitted',1,'leadership',now()),
        ('${u(32)}','${u(20)}','2026-10-12','${u(1)}','${u(1)}',null,'submitted',1,'leadership',now()),
        ('${u(33)}','${u(20)}','2026-10-26','${u(1)}',null,null,'draft',0,'leadership',null);
      insert into public.pastoral_notes values('${u(41)}','${u(3)}','all','김은혜 집사','내용',null,now(),true);
      insert into public.push_subscriptions values('${u(1)}','ep-1','k','a','ko');
    `);
    await db.exec(base);
    // 기존 방식으로 이미 쌓인 동정 알림 (이름 없음)
    await db.exec(`insert into report.cellcare_notification_items(profile_id,event_key,title,body,url) values('${u(2)}','note-${u(41)}','성도 동정이 공유되었습니다','x','./#note=${u(41)}')`);
    const before = (await db.query('select count(*)::int c from public.weekly_reports')).rows[0].c;
    await db.exec(migration);
    await db.exec(migration); // 다시 실행해도 안전
    assert.equal((await db.query('select count(*)::int c from public.weekly_reports')).rows[0].c, before);

    const actor = n => db.exec(`set test.actor='${u(n)}'`);
    const add = (report, text = '내용') => db.query('select report.cellcare_talk_add($1,$2) as id', [report, text]);
    const list = report => db.query('select * from report.cellcare_talk_list($1)', [report]);

    await actor(2);
    const q1 = (await add(u(31), '김OO 성도님과 이야기 나눠 보셨나요?')).rows[0].id;
    await assert.rejects(add(u(33)), /권한/);              // 작성 중 보고서는 대화 불가
    await assert.rejects(add(u(31), '   '));               // 빈 글 거부
    await actor(1);
    assert.equal((await list(u(31))).rows.length, 1);
    assert.equal((await list(u(31))).rows[0].author_role, 'leadership');
    assert.equal((await list(u(32))).rows.length, 0);       // 다른 주차와 섞이지 않음
    const n1 = (await db.query(`select title,url from report.cellcare_notification_items where profile_id='${u(1)}' and event_key='talk-${q1}'`)).rows;
    assert.equal(n1.length, 1);
    assert.ok(n1[0].title.includes('은혜셀'));
    assert.ok(n1[0].url.endsWith('&talk=' + q1));
    const a1 = (await add(u(31), '네, 화요일에 통화했습니다.')).rows[0].id;
    assert.equal((await list(u(31))).rows.at(-1).author_role, 'leader');
    assert.equal((await db.query(`select count(*)::int c from report.cellcare_notification_items where profile_id='${u(2)}' and event_key='talk-${a1}'`)).rows[0].c, 1);
    assert.equal((await db.query(`select count(*)::int c from report.cellcare_notification_items where profile_id='${u(1)}' and event_key='talk-${a1}'`)).rows[0].c, 0);

    await actor(3);                                         // 읽을 수 있어도 담당이 아니면 대화에 못 들어옴
    assert.equal((await list(u(31))).rows.length, 0);
    await assert.rejects(add(u(31)), /권한/);
    await actor(4);
    assert.equal((await list(u(31))).rows.length, 0);
    await assert.rejects(add(u(31)), /권한/);

    await actor(2);
    await assert.rejects(db.query('select report.cellcare_talk_delete($1)', [a1]), /권한/); // 남의 글
    await actor(1);
    await db.query('select report.cellcare_talk_delete($1)', [a1]);
    assert.equal((await list(u(31))).rows.length, 1);
    await actor(2);
    assert.equal((await db.query('select * from report.cellcare_notification_list()')).rows.some(r => r.url.endsWith(a1)), false);

    // 푸시는 쓴 본인 로그인으로 한 번만
    assert.equal((await db.query('select * from report.cellcare_talk_push_targets($1,$2)', [q1, u(13)])).rows.length, 0);
    const push = (await db.query('select * from report.cellcare_talk_push_targets($1,$2)', [q1, u(12)])).rows;
    assert.equal(push.length, 1); assert.equal(push[0].endpoint, 'ep-1');
    assert.equal((await db.query('select * from report.cellcare_talk_push_targets($1,$2)', [q1, u(12)])).rows.length, 0);

    // 성도 동정 알림: 이름이 보인다 (기존 기록도 고쳐짐)
    const notes = (await db.query('select title from report.cellcare_notification_list() where url like $1', ['%#note=%'])).rows;
    assert.deepEqual(notes.map(r => r.title), ['[성도 동정] 김은혜 집사']);

    // 직접 접근과 서버 전용 함수는 막힘
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from report.cellcare_report_talk'), /permission denied/);
    await assert.rejects(db.query('select * from report.cellcare_talk_push_targets($1,$2)', [q1, u(12)]), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});
