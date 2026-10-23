-- 담임 목사님·담임 사모님 「확인했습니다」 기록 (두 분이 각자 남김, 사용자 결정 2026-10-23)
--   report     : 직접 확인하는 셀(senior_direct) 보고서, 교역자가 「목양/긴급 확인 필요」로 올린 보고서
--   pastor_msg : 보고서의 「담임 목사님께 드리는 말씀」 (대상 id = 보고서 id)
--   lr         : 교역자 보고 (대상 id = 교역자 보고 id)
-- 성도 동정은 기존 pastoral_note_ack를 그대로 쓴다. 기존 테이블·함수는 바꾸지 않는다.
-- 여러 번 실행해도 안전하다. 앱보다 먼저 적용한다(먼저 앱이 나가도 확인 칸만 숨겨진다).
begin;
create schema if not exists report;
grant usage on schema report to authenticated,service_role;

create table if not exists report.cellcare_senior_acks (
 kind text not null check(kind in ('report','pastor_msg','lr')),
 target_id uuid not null,
 role text not null check(role in ('senior_pastor','samonim')),
 profile_id uuid not null references public.profiles(id),
 acked_at timestamptz not null default now(),
 primary key(kind,target_id,role)
);
alter table report.cellcare_senior_acks enable row level security;
revoke all on report.cellcare_senior_acks from public,anon,authenticated;

-- 지금 로그인한 분의 확인 역할(담임 목사님 / 담임 사모님). 아니면 null
create or replace function report.cellcare_senior_role() returns text
language sql stable security definer set search_path='' as $$
 select case when not exists(select 1 from public.profiles where id=private.current_profile_id() and active) then null
   when private.has_role('senior_pastor') then 'senior_pastor'
   when private.has_role('samonim') then 'samonim' end;
$$;

-- 대상마다 원본의 지금 권한으로 다시 검사한다
create or replace function report.cellcare_senior_ack_visible(p_kind text,p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=private.current_profile_id() and active) and case p_kind
   when 'report' then private.can_read_report(p_id)
   when 'pastor_msg' then private.can_see_senior_comment(p_id,'pastor_msg')
   when 'lr' then private.is_senior() or private.has_role('leadership') or private.is_admin()
   else false end;
$$;

create or replace function report.cellcare_senior_ack(p_kind text,p_id uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare v_role text := report.cellcare_senior_role(); v_at timestamptz;
begin
 if v_role is null then raise exception '담임 목사님·담임 사모님만 확인 표시를 할 수 있습니다.' using errcode='42501'; end if;
 if not report.cellcare_senior_ack_visible(p_kind,p_id)
   or (p_kind='report' and not exists(select 1 from public.weekly_reports r where r.id=p_id and r.status='submitted')) then
   raise exception '확인 표시를 할 수 없는 항목입니다.' using errcode='42501';
 end if;
 -- 다시 제출된 보고서는 다시 확인할 수 있게 시간을 새로 남긴다
 insert into report.cellcare_senior_acks(kind,target_id,role,profile_id) values(p_kind,p_id,v_role,private.current_profile_id())
 on conflict(kind,target_id,role) do update set profile_id=excluded.profile_id,acked_at=now()
 returning acked_at into v_at;
 return v_at;
end $$;

create or replace function report.cellcare_senior_acks(p_kind text,p_ids uuid[]) returns table(target_id uuid,role text,name text,acked_at timestamptz)
language sql stable security definer set search_path='' as $$
 select a.target_id,a.role,p.name,a.acked_at from report.cellcare_senior_acks a join public.profiles p on p.id=a.profile_id
 where a.kind=p_kind and a.target_id=any(p_ids) and report.cellcare_senior_ack_visible(a.kind,a.target_id);
$$;

revoke all on function report.cellcare_senior_role(),report.cellcare_senior_ack_visible(text,uuid) from public,anon,authenticated;
revoke all on function report.cellcare_senior_ack(text,uuid),report.cellcare_senior_acks(text,uuid[]) from public,anon;
grant execute on function report.cellcare_senior_ack(text,uuid),report.cellcare_senior_acks(text,uuid[]) to authenticated;
commit;
