-- 부산 셀 담당 정리 + 함께 맡는 셀을 놓치지 않게 (2026-11-05, 사용자 결정)
--   지금 부산 셀 6개는 모두 staff_shared(교역자 모두가 담당), 담당 배정 없음(2026-11-05 운영에서 읽음).
--   - 남장년1 → 이흥배 목사, 여장년1·2 → 황성수 사모: 공동을 풀고 이번 주(2026-11-02)부터 담당 배정.
--   - 남장년2는 교역자 모두가 셀리더인 셀(검토 없음)이라 담당을 둘 수 없다(check_leadership_assignment: 셀리더는 같은 셀 담당 불가).
--     그대로 둔다(2026-11-05 첫 적용이 이 이유로 실패해 전부 되돌려짐 → 사용자 확인 후 제외).
--   - 청년1·2 → 이흥배 목사·황성수 사모 공동: staff_shared는 그대로 두고 「함께 맡는 교역자」 목록을 둔다.
--     목록이 있는 공동 셀은 목록에 있는 분만 담당. 목록이 없는 공동 셀은 예전처럼 교역자 모두.
--     leadership_assignments는 한 셀·한 기간에 한 분만 가능(제외 제약)이라 공동은 이 목록으로만 한다.
--   - 다른 교역자는 부산 셀에서 빠진다. 지난 부산 보고서도 보이지 않는다(사용자 확인).
--   권한은 모두 private.is_cell_leadership으로 판단하므로 이 함수만 고친다(본문은 2026-11-05 운영에서 읽음, 공동 셀 조건 한 줄 추가).
--   공동 셀에서 다른 분이 먼저 확인한 보고서를 아직 안 본 분에게 계속 보여 주려고, 내가 연 보고서를 알려 주는 함수를 둔다.
-- 여러 번 실행해도 안전하다. 앱보다 먼저 적용한다.
begin;
create schema if not exists report;
grant usage on schema report to authenticated,service_role;

create table if not exists report.cellcare_shared_staff (
 cell_id uuid not null references public.cells(id),
 profile_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 primary key(cell_id,profile_id)
);
alter table report.cellcare_shared_staff enable row level security;
revoke all on report.cellcare_shared_staff from public,anon,authenticated;

create or replace function private.is_cell_leadership(p_cell uuid, d date default null::date)
 returns boolean language sql stable security definer set search_path to 'public','private','pg_temp' as $function$
  select private.has_role('leadership') and (
    exists (
      select 1 from public.leadership_assignments la
       where la.cell_id = p_cell and la.leadership_user_id = private.current_profile_id()
         and la.start_date <= coalesce(d, private.app_today())
         and (la.end_date is null or la.end_date >= coalesce(d, private.app_today())))
    or exists (
      select 1 from public.cells c
       where c.id = p_cell and c.active and c.staff_shared
         and exists (select 1 from public.cell_leaders cl where cl.cell_id = c.id
                      and cl.start_date <= coalesce(d + 6, private.app_today()))
         and (not exists (select 1 from report.cellcare_shared_staff s where s.cell_id = c.id)
              or exists (select 1 from report.cellcare_shared_staff s where s.cell_id = c.id and s.profile_id = private.current_profile_id()))))
$function$;

-- 화면 표시용: 공동 셀의 함께 맡는 분 이름
create or replace function report.cellcare_shared_staff_list() returns table(cell_id uuid,names text)
language sql stable security definer set search_path='' as $$
 select s.cell_id,string_agg(p.name,', ' order by p.name) from report.cellcare_shared_staff s join public.profiles p on p.id=s.profile_id
 where exists(select 1 from public.profiles me where me.id=private.current_profile_id() and me.active)
 group by s.cell_id
$$;
revoke all on function report.cellcare_shared_staff_list() from public,anon;
grant execute on function report.cellcare_shared_staff_list() to authenticated;

-- 셀 이동 등 화면의 「담당」 표시: 목록이 있는 공동 셀은 그 이름들
create or replace function report.cellcare_cell_staff(p_cell uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when c.staff_shared then coalesce((select string_agg(p.name, ', ' order by p.name) from report.cellcare_shared_staff s join public.profiles p on p.id=s.profile_id where s.cell_id=c.id),'교역자 공동')
   when c.review_mode::text='senior_direct' then '담임 목사님·담임 사모님'
   else (select string_agg(p.name, ', ' order by p.name) from public.leadership_assignments a join public.profiles p on p.id=a.leadership_user_id
         where a.cell_id=c.id and a.start_date<=private.app_today() and (a.end_date is null or a.end_date>=private.app_today())) end
 from public.cells c where c.id=p_cell;
$$;
revoke all on function report.cellcare_cell_staff(uuid) from public,anon,authenticated;

-- 내가 상세 화면으로 연 보고서(cellcare_report_open 기록) 가운데 주어진 것만
create or replace function report.cellcare_my_report_reads(p_reports uuid[]) returns table(report_id uuid,last_read_at timestamptz)
language sql stable security definer set search_path='' as $$
 select r.report_id,r.last_read_at from report.cellcare_report_reads r
 where r.profile_id=private.current_profile_id() and r.report_id=any(coalesce(p_reports,'{}'))
$$;
revoke all on function report.cellcare_my_report_reads(uuid[]) from public,anon;
grant execute on function report.cellcare_my_report_reads(uuid[]) to authenticated;

-- 자료: 이름이 정확히 한 분·한 셀일 때만 진행
do $$
declare v_lee uuid; v_hwang uuid; v_cell uuid; n int; x record;
begin
 select count(*),min(id::text)::uuid into n,v_lee from public.profiles where name='이흥배 목사' and active;
 if n<>1 then raise exception '이흥배 목사 계정을 하나로 찾지 못했습니다(%).',n; end if;
 select count(*),min(id::text)::uuid into n,v_hwang from public.profiles where name='황성수 사모' and active;
 if n<>1 then raise exception '황성수 사모 계정을 하나로 찾지 못했습니다(%).',n; end if;
 for x in select * from (values ('부산 남장년1 셀',v_lee),('부산 여장년1 셀',v_hwang),('부산 여장년2 셀',v_hwang)) t(cell_name,who) loop
   select count(*),min(id::text)::uuid into n,v_cell from public.cells where name=x.cell_name and campus='부산' and active;
   if n<>1 then raise exception '%을 하나로 찾지 못했습니다(%).',x.cell_name,n; end if;
   update public.cells set staff_shared=false,review_mode='leadership' where id=v_cell and (staff_shared or review_mode::text<>'leadership');
   if not exists(select 1 from public.leadership_assignments where cell_id=v_cell and (end_date is null or end_date>='2026-11-02')) then
     insert into public.leadership_assignments(cell_id,leadership_user_id,start_date) values(v_cell,x.who,'2026-11-02');
   end if;
 end loop;
 for x in select * from (values ('부산 청년1 셀'),('부산 청년2 셀')) t(cell_name) loop
   select count(*),min(id::text)::uuid into n,v_cell from public.cells where name=x.cell_name and campus='부산' and active and staff_shared;
   if n<>1 then raise exception '%을 하나로 찾지 못했습니다(%).',x.cell_name,n; end if;
   insert into report.cellcare_shared_staff(cell_id,profile_id) values(v_cell,v_lee),(v_cell,v_hwang) on conflict do nothing;
 end loop;
end $$;
commit;
