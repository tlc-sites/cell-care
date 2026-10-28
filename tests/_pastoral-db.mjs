import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
// 목회적 케어 보고·보고서 열람 테스트용 가상 DB (운영 접속 없음)
const read = (f) => readFile(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const [notifications, seniorAcks, refs, pastoral] = await Promise.all(['20261021010000_notifications_replies.sql', '20261023010000_senior_acks.sql',
  '20261026000000_notification_refs_report_reads.sql', '20261026010000_pastoral_alerts.sql'].map(read));
const u = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 사람: 1 담임 목사님, 2 담임 사모님, 3 교역자 A, 4 교역자 B, 5 셀리더(사랑셀), 6 셀리더(은혜셀), 7 관리자
// 셀: 11 사랑셀, 12 은혜셀, 13 소망셀(1주만 못 모임), 14 닫힌 셀
export async function makeDb() {
  const db = new PGlite();
  await db.exec(`
   create role anon; create role authenticated; create role service_role;
   create schema private;
   create table public.profiles(id uuid primary key,auth_user_id uuid,name text,email text,active boolean);
   create table public.cells(id uuid primary key,name text,active boolean,meet_day text,created_at timestamptz default '2026-01-01');
   create table public.weekly_reports(id uuid primary key,cell_id uuid,week_start date,created_by uuid,submitted_by uuid,reviewer_user_id uuid,status text,
     submission_no integer default 1,review_mode text default 'leadership',submitted_at timestamptz,meeting_held boolean,meeting_date date);
   create table public.cell_leaders(cell_id uuid,user_id uuid,start_date date,end_date date,is_primary boolean);
   create table public.leadership_assignments(cell_id uuid,leadership_user_id uuid,start_date date,end_date date);
   create table public.user_roles(user_id uuid,role text);
   create table public.push_subscriptions(profile_id uuid,endpoint text,p256dh text,auth text,lang text);
   create table public.senior_comments(id uuid primary key,report_id uuid,target text,author_id uuid,content text,created_at timestamptz,deleted_at timestamptz);
   create table public.pastoral_note_comments(id uuid primary key,note_id uuid,author_id uuid,content text,created_at timestamptz,deleted_at timestamptz);
   create table public.msg_participants(thread_id uuid,profile_id uuid);
   create table public.msg_posts(id uuid,thread_id uuid,author_id uuid,body text,created_at timestamptz);
   create table public.announcements(id uuid,title text,body text,author_id uuid,created_at timestamptz,deleted_at timestamptz);
   create table public.pastoral_notes(id uuid,author_id uuid,person_name text,content text,prayer text,created_at timestamptz,active boolean default true);
   create function private.current_profile_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
   create function private.has_role(r text) returns boolean language sql as $$
     select (r='senior_pastor' and private.current_profile_id()='${u(1)}'::uuid) or (r='samonim' and private.current_profile_id()='${u(2)}'::uuid)
         or (r='leadership' and private.current_profile_id() in ('${u(3)}'::uuid,'${u(4)}'::uuid))$$;
   create function private.is_senior() returns boolean language sql as $$select private.has_role('senior_pastor') or private.has_role('samonim')$$;
   create function private.is_admin() returns boolean language sql as $$select private.current_profile_id()='${u(7)}'::uuid$$;
   create function private.is_cell_leadership(uuid) returns boolean language sql as $$select private.current_profile_id() in ('${u(3)}'::uuid,'${u(4)}'::uuid)$$;
   -- 셀리더 6은 사랑셀 보고서를 못 읽는다
   create function private.can_read_report(p uuid) returns boolean language sql as $$
     select private.current_profile_id() in ('${u(1)}'::uuid,'${u(2)}'::uuid,'${u(3)}'::uuid,'${u(4)}'::uuid,'${u(5)}'::uuid,'${u(7)}'::uuid)$$;
   -- 운영에 이미 있는 보고서 대화(20261022000000): 지운 대화 알림은 목록에서 숨긴다
   create schema if not exists report;
   create table report.cellcare_report_talk(id uuid primary key default gen_random_uuid(),report_id uuid not null,author_id uuid not null,author_role text not null,
     content text not null,created_at timestamptz not null default now(),deleted_at timestamptz,notified_at timestamptz);
   create function private.can_see_senior_comment(uuid,text) returns boolean language sql as $$select private.is_senior()$$;
   create function private.can_read_pastoral_note(uuid) returns boolean language sql as $$select false$$;
   insert into public.profiles values
     ('${u(1)}',null,'담임 목사님','p@example.com',true),('${u(2)}',null,'담임 사모님','s@example.com',true),('${u(3)}',null,'김교역 전도사',null,true),
     ('${u(4)}',null,'박교역 목사',null,true),('${u(5)}',null,'김사랑',null,true),('${u(6)}',null,'이은혜',null,true),('${u(7)}',null,'관리자',null,true);
   insert into public.cells(id,name,active,meet_day) values('${u(11)}','사랑셀',true,'금'),('${u(12)}','은혜셀',true,'수'),('${u(13)}','소망셀',true,'목'),('${u(14)}','닫힌셀',false,'금');
   insert into public.cell_leaders values('${u(11)}','${u(5)}','2026-01-01',null,true),('${u(12)}','${u(6)}','2026-01-01',null,true);
   insert into public.leadership_assignments values('${u(11)}','${u(3)}','2026-01-01',null),('${u(12)}','${u(4)}','2026-01-01',null),('${u(13)}','${u(3)}','2026-01-01',null);
  `);
  await db.exec(notifications); await db.exec(seniorAcks);
  await db.exec(refs); await db.exec(pastoral);
  await db.exec(refs); await db.exec(pastoral); // 다시 실행해도 안전
  return db;
}
let seq = 100;
export async function report(db, cell, week, held, extra = {}) {
  const id = u(seq++);
  await db.query(`insert into public.weekly_reports(id,cell_id,week_start,submitted_by,status,submitted_at,meeting_held,meeting_date,submission_no)
    values($1,$2,$3,$4,'submitted',$5,$6,$7,$8)`, [id, cell, week, extra.by || u(5), extra.at || week + 'T12:00:00Z', held, held ? week : null, extra.no || 1]);
  return id;
}
