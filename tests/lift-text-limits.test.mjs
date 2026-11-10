import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261110000000_lift_text_limits.sql', import.meta.url), 'utf8');
const VERIFY = (await readFile(new URL('./fixtures/verify-lift-text-limits.sql', import.meta.url), 'utf8'));
const u = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// 운영과 같은 이름의 제약을 가진 최소한의 표·함수만 만든다
async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema private; create schema report;
    create function private.current_profile_id() returns uuid language sql as $$select '${u(1)}'::uuid$$;
    create function private.is_senior() returns boolean language sql as $$select true$$;
    create function private.has_role(text) returns boolean language sql as $$select true$$;
    create function private.can_read_pastoral_note(uuid) returns boolean language sql as $$select true$$;
    create function private.can_post_notice() returns boolean language sql as $$select true$$;
    create function private.msg_is_member(uuid) returns boolean language sql as $$select true$$;
    create function private.msg_can_send_to(uuid) returns boolean language sql as $$select true$$;
    create type escalation_level as enum ('none'); create type leader_message as enum ('none','yes');
    create type care_category as enum ('health'); create type attendance_status as enum ('unknown'); create type prayer_status as enum ('ongoing');
    create table weekly_reports(id uuid primary key, cell_id uuid, week_start date, status text, version int, submitted_at timestamptz);
    create table leadership_reports(id uuid primary key, author_id uuid, week_start date, status text);
    create table leadership_reviews(id uuid primary key, reviewer_id uuid, report_id uuid, submission_no int);
    create table announcements(id uuid primary key default gen_random_uuid(), author_id uuid, title text constraint announcements_title_check check (char_length(title) between 1 and 80),
      body text constraint announcements_body_check check (char_length(body) <= 3000));
    create table msg_threads(id uuid primary key default gen_random_uuid(), created_by uuid, report_id uuid, last_at timestamptz);
    create table msg_participants(thread_id uuid, profile_id uuid, last_read_at timestamptz);
    create table msg_posts(id uuid primary key default gen_random_uuid(), thread_id uuid, author_id uuid,
      body text constraint msg_posts_body_check check (char_length(body) >= 1 and char_length(body) <= 4000));
    create table pastoral_notes(id uuid primary key, active boolean default true,
      person_name text constraint pastoral_notes_person_name_check check (char_length(person_name) >= 1 and char_length(person_name) <= 60),
      content text constraint pastoral_notes_content_check check (char_length(content) >= 1 and char_length(content) <= 4000),
      prayer text constraint pastoral_notes_prayer_check check (char_length(prayer) <= 2000));
    create table pastoral_note_comments(id uuid primary key default gen_random_uuid(), note_id uuid, author_id uuid, content text);
    create table report.cellcare_comment_replies(id serial, content text constraint cellcare_comment_replies_content_check check (char_length(btrim(content)) >= 1 and char_length(btrim(content)) <= 3000));
    create table report.cellcare_report_talk(id serial, content text constraint cellcare_report_talk_content_check check (char_length(btrim(content)) >= 1 and char_length(btrim(content)) <= 3000));
    create table report.cellcare_member_moves(id serial, memo text constraint cellcare_member_moves_memo_check check (memo is null or char_length(memo) <= 1000));
    insert into pastoral_notes(id, person_name, content) values ('${u(10)}', '성도', '처음');
  `);
  return db;
}
const long = n => '가'.repeat(n);

test('긴 글 제한 없애기: 긴 글은 그대로 저장, 빈 글·짧은 칸 제한은 그대로', async () => {
  const db = await setup();
  try {
    assert.equal((await db.query(VERIFY)).rows[0].ok, false);  // 적용 전에는 false
    await db.exec(migration);
    await db.exec(migration); // 다시 실행해도 안전
    assert.equal((await db.query(VERIFY)).rows[0].ok, true);   // 사용자에게 드리는 확인 쿼리
    await db.query(`insert into pastoral_notes(id, person_name, content, prayer) values ($1, '성도', $2, $3)`, [u(11), long(20000), long(9000)]);
    await assert.rejects(db.query(`insert into pastoral_notes(id, person_name, content) values ($1, '성도', '')`, [u(12)]));
    await assert.rejects(db.query(`insert into pastoral_notes(id, person_name, content) values ($1, $2, '내용')`, [u(13), long(61)]));  // 이름 60자는 그대로
    await db.query(`insert into report.cellcare_comment_replies(content) values ($1)`, [long(10000)]);
    await db.query(`insert into report.cellcare_report_talk(content) values ($1)`, [long(10000)]);
    await assert.rejects(db.query(`insert into report.cellcare_report_talk(content) values ('  ')`));
    await db.query(`insert into report.cellcare_member_moves(memo) values ($1)`, [long(5000)]);

    const t = (await db.query(`select public.msg_start(array['${u(2)}']::uuid[], $1) j`, [long(12000)])).rows[0].j.thread;
    await db.query(`select public.msg_post($1, $2)`, [t, long(9000)]);
    await assert.rejects(db.query(`select public.msg_post($1, '   ')`, [t]), /보낼 내용/);
    assert.deepEqual((await db.query('select char_length(body) n from msg_posts order by n')).rows.map(r => r.n), [9000, 12000]);

    await db.query(`select public.note_comment_add($1, $2)`, [u(10), long(8000)]);
    assert.equal((await db.query('select char_length(content) n from pastoral_note_comments')).rows[0].n, 8000);  // 예전엔 3000에서 잘림
    await db.query(`select public.notice_create($1, $2)`, [long(100), long(7000)]);
    const ann = (await db.query('select char_length(title) t, char_length(body) b from announcements')).rows[0];
    assert.deepEqual([ann.t, ann.b], [80, 7000]);  // 제목 80자는 그대로
  } finally { await db.close(); }
});
