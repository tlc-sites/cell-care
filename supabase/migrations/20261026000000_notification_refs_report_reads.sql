-- 셀보고서 알림의 참조값·이름 보존 + 보고서 열람 기록 (2026-10-26)
--   1) 알림 항목에 report_id·cell_id·author_id(참조)와 cell_name·author_name(그때의 이름) 칸을 더한다. 모두 nullable.
--      셀보고서 제출 알림(event_key 'submit-<보고서>-<제출 번호>')은 넣을 때 트리거가 채운다. 기존 행도 채운다.
--   2) 보고서를 상세 화면으로 열면 그 사람의 열람 기록을 남기고, 그 사람에게 온 같은 보고서의 제출 알림만 읽음으로 바꾼다.
--   보고서 열람 · 알림 읽음 · 목회적 케어 확인(20261026010000)은 서로 다른 테이블이다.
-- 기존 업무 테이블(public)은 바꾸지 않는다. 여러 번 실행해도 안전하다. 앱보다 먼저 적용한다.
begin;
create schema if not exists report;
grant usage on schema report to authenticated,service_role;

alter table report.cellcare_notification_items
  add column if not exists kind text,
  add column if not exists report_id uuid,
  add column if not exists cell_id uuid,
  add column if not exists author_id uuid,
  add column if not exists cell_name text,
  add column if not exists author_name text,
  add column if not exists week_start date;
create index if not exists cellcare_notification_items_report_idx on report.cellcare_notification_items(profile_id,report_id) where report_id is not null;

create table if not exists report.cellcare_report_reads (
 report_id uuid not null,
 profile_id uuid not null references public.profiles(id),
 first_read_at timestamptz not null default now(),
 last_read_at timestamptz not null default now(),
 read_count integer not null default 1,
 primary key(report_id,profile_id)
);
alter table report.cellcare_report_reads enable row level security;
revoke all on report.cellcare_report_reads from public,anon,authenticated;

-- 제출 알림을 넣을 때 참조값과 이름을 채운다(푸시 기록·알림함 동기화 두 경로 모두).
-- 이미 그 제출 뒤에 보고서를 연 사람이면 처음부터 읽음으로 넣는다.
create or replace function report.cellcare_notification_fill() returns trigger
language plpgsql security definer set search_path='' as $$
declare m text[]; r record;
begin
 m := regexp_match(new.event_key,'^submit-([0-9a-fA-F-]{36})-([0-9]+)$');
 if m is null then return new; end if;
 select x.id,x.cell_id,x.submitted_by,x.week_start,x.submitted_at,c.name cell_name,p.name author_name into r
 from public.weekly_reports x left join public.cells c on c.id=x.cell_id left join public.profiles p on p.id=x.submitted_by
 where x.id=m[1]::uuid;
 new.kind := coalesce(new.kind,case when m[2]::int>1 then 'REPORT_UPDATED' else 'REPORT_SUBMITTED' end);
 new.report_id := coalesce(new.report_id,m[1]::uuid);
 if r.id is not null then
   new.cell_id := coalesce(new.cell_id,r.cell_id);
   new.author_id := coalesce(new.author_id,r.submitted_by);
   new.week_start := coalesce(new.week_start,r.week_start);
   new.cell_name := coalesce(nullif(btrim(new.cell_name),''),nullif(btrim(r.cell_name),''));
   new.author_name := coalesce(nullif(btrim(new.author_name),''),nullif(btrim(r.author_name),''));
   if new.read_at is null and exists(select 1 from report.cellcare_report_reads rr
      where rr.report_id=r.id and rr.profile_id=new.profile_id and rr.last_read_at>=coalesce(r.submitted_at,'-infinity'::timestamptz)) then
     new.read_at := now();
   end if;
 end if;
 return new;
exception when invalid_text_representation then return new;
end $$;
revoke all on function report.cellcare_notification_fill() from public,anon,authenticated;
drop trigger if exists cellcare_notification_fill on report.cellcare_notification_items;
create trigger cellcare_notification_fill before insert on report.cellcare_notification_items
 for each row execute function report.cellcare_notification_fill();

-- 기존 제출 알림 채우기(빈 칸만)
update report.cellcare_notification_items n set
 kind=coalesce(n.kind,case when split_part(substr(n.event_key,45),'-',1)~'^[0-9]+$' and split_part(substr(n.event_key,45),'-',1)::int>1 then 'REPORT_UPDATED' else 'REPORT_SUBMITTED' end),
 report_id=coalesce(n.report_id,x.id),cell_id=coalesce(n.cell_id,x.cell_id),author_id=coalesce(n.author_id,x.submitted_by),week_start=coalesce(n.week_start,x.week_start),
 cell_name=coalesce(n.cell_name,nullif(btrim(c.name),'')),author_name=coalesce(n.author_name,nullif(btrim(p.name),''))
from public.weekly_reports x left join public.cells c on c.id=x.cell_id left join public.profiles p on p.id=x.submitted_by
where n.event_key ~ '^submit-[0-9a-fA-F-]{36}-[0-9]+$' and x.id=substr(n.event_key,8,36)::uuid
 and (n.kind is null or n.report_id is null or n.cell_name is null or n.author_name is null);

-- 알림 목록: 돌려주는 칸이 늘어나므로 지우고 다시 만든다(20261022000000 본문 그대로 — 지운 답글·대화 알림 숨김 포함 — 칸만 추가)
-- 이름은 지금 정보 → 그때 저장한 이름 → 「… 정보 없음」 순서. 제출 알림이 아니면 null.
drop function if exists report.cellcare_notification_list();
create function report.cellcare_notification_list() returns table(id uuid,title text,body text,url text,created_at timestamptz,read_at timestamptz,
 kind text,report_id uuid,cell_name text,author_name text,week_start date)
language plpgsql security definer set search_path='' as $$
begin
 perform report.cellcare_sync_notifications();
 return query
 select n.id,n.title,n.body,n.url,n.created_at,n.read_at,n.kind,n.report_id,
 case when n.kind is null then null else coalesce(nullif(btrim(c.name),''),nullif(btrim(n.cell_name),''),'셀 정보 없음') end,
 case when n.kind is null then null else coalesce(nullif(btrim(p.name),''),nullif(btrim(n.author_name),''),'작성자 정보 없음') end,
 n.week_start
 from report.cellcare_notification_items n left join public.cells c on c.id=n.cell_id left join public.profiles p on p.id=n.author_id
 where n.profile_id=private.current_profile_id() and report.cellcare_route_allowed(n.url)
 and (n.event_key not like 'reply-%' or exists(select 1 from report.cellcare_comment_replies r where 'reply-'||r.id=n.event_key and r.deleted_at is null))
 and (n.event_key not like 'talk-%' or exists(select 1 from report.cellcare_report_talk t where 'talk-'||t.id=n.event_key and t.deleted_at is null))
 order by n.created_at desc,n.id desc limit 100;
end;
$$;
revoke all on function report.cellcare_notification_list() from public,anon;
grant execute on function report.cellcare_notification_list() to authenticated;

-- 보고서 상세 화면을 열었을 때: 열람 기록 + 지금 로그인한 분에게 온 같은 보고서의 제출 알림만 읽음
-- 목회적 케어 보고(pastoral alert)는 건드리지 않는다. 돌려주는 값: 읽음으로 바꾼 알림 수
create or replace function report.cellcare_report_open(p_report uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare me uuid := private.current_profile_id(); n integer;
begin
 if not exists(select 1 from public.profiles where id=me and active) or not private.can_read_report(p_report) then
   raise exception '보고서를 볼 권한이 없습니다.' using errcode='42501';
 end if;
 insert into report.cellcare_report_reads(report_id,profile_id) values(p_report,me)
 on conflict(report_id,profile_id) do update set last_read_at=now(),read_count=report.cellcare_report_reads.read_count+1;
 update report.cellcare_notification_items x set read_at=now()
 where x.profile_id=me and x.read_at is null and x.kind in ('REPORT_SUBMITTED','REPORT_UPDATED')
   and (x.report_id=p_report or x.event_key like 'submit-'||p_report::text||'-%');
 get diagnostics n = row_count;
 return n;
end $$;
revoke all on function report.cellcare_report_open(uuid) from public,anon;
grant execute on function report.cellcare_report_open(uuid) to authenticated;
commit;
