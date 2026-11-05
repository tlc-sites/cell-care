import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261106010000_note_notification_author.sql', import.meta.url), 'utf8');
const u = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('성도 동정 공유·코멘트 알림에 쓴 분 이름, 셀보고서 알림은 예전 그대로, 다른 알림은 이름 없음', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private; create schema report;
      create table public.profiles(id uuid primary key,name text);
      insert into public.profiles values ('${u(1)}','받는 분'),('${u(2)}','정교역 목사'),('${u(3)}','김교역 전도사'),('${u(4)}','셀리더');
      create table public.cells(id uuid primary key,name text);
      insert into public.cells values ('${u(20)}','사랑셀');
      create table public.pastoral_notes(id uuid primary key,author_id uuid);
      insert into public.pastoral_notes values ('${u(30)}','${u(2)}');
      create table public.pastoral_note_comments(id uuid primary key,note_id uuid,author_id uuid);
      insert into public.pastoral_note_comments values ('${u(31)}','${u(30)}','${u(3)}');
      create table report.cellcare_comment_replies(id uuid,deleted_at timestamptz);
      create table report.cellcare_report_talk(id uuid,deleted_at timestamptz);
      create table report.cellcare_notification_items(id uuid primary key default gen_random_uuid(),profile_id uuid,event_key text,title text,body text,url text,
        created_at timestamptz default now(),read_at timestamptz,kind text,report_id uuid,cell_id uuid,author_id uuid,cell_name text,author_name text,week_start date);
      create function private.current_profile_id() returns uuid language sql as $$select '${u(1)}'::uuid$$;
      create function report.cellcare_sync_notifications() returns void language sql as $$select$$;
      create function report.cellcare_route_allowed(text) returns boolean language sql as $$select true$$;
      insert into report.cellcare_notification_items(profile_id,event_key,title,body,url,created_at,kind,cell_id,author_id) values
        ('${u(1)}','note-${u(30)}','[성도 동정] 가','b','./#note=${u(30)}','2026-11-01',null,null,null),
        ('${u(1)}','ncmt-${u(31)}','[성도 동정] 가 · 코멘트','b','./#note=${u(30)}&comment=${u(31)}','2026-11-02',null,null,null),
        ('${u(1)}','submit-x-1','셀 보고서','b','./#report=x','2026-11-03','REPORT_SUBMITTED','${u(20)}','${u(4)}'),
        ('${u(1)}','msg-t-1','메시지','b','./#thread=t','2026-11-04',null,null,null),
        ('${u(1)}','note-${u(39)}','[성도 동정] 지워진 동정','b','./#note=${u(39)}','2026-10-30',null,null,null),
        ('${u(2)}','note-${u(30)}','남의 알림','b','./#note=${u(30)}','2026-11-05',null,null,null);
    `);
    await db.exec(migration);
    await db.exec(migration); // 다시 실행해도 안전
    const rows = (await db.query('select title,author_name,cell_name from report.cellcare_notification_list()')).rows;
    assert.deepEqual(rows.map(r => [r.title, r.author_name, r.cell_name]), [
      ['메시지', null, null], ['셀 보고서', '셀리더', '사랑셀'], ['[성도 동정] 가 · 코멘트', '김교역 전도사', null], ['[성도 동정] 가', '정교역 목사', null], ['[성도 동정] 지워진 동정', null, null]]);
    const grant = (await db.query(`select has_function_privilege('anon','report.cellcare_notification_list()','execute') a, has_function_privilege('authenticated','report.cellcare_notification_list()','execute') b`)).rows[0];
    assert.deepEqual([grant.a, grant.b], [false, true]);
  } finally { await db.close(); }
});
