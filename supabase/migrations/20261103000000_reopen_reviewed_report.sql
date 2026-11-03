-- 교역자 확인이 끝난 셀보고서도 셀리더가 다시 고치기 (2026-11-03)
--   운영 public.reopen_report는 확인(reviewed)된 보고서를 막는다. public은 건드리지 않고 report 스키마에 새 함수를 둔다.
--   본문은 public.reopen_report(2026-11-03 운영에서 읽음)와 같고, 다른 점은 두 가지다.
--     1) 확인된 보고서도 연다.
--     2) 확인된 보고서를 열면 확인 표시(reviewed_at·reviewed_by)를 지우고 「확인 대기」로 돌린다. 내용이 바뀌므로 다시 확인받는다.
--        누가 언제 확인했었는지는 report_events의 'reopened' 기록에 남긴다.
--   다시 제출하면 public.submit_report가 그대로 「확인 대기」로 만든다(운영 본문 확인).
-- 여러 번 실행해도 안전하다. 앱보다 먼저 적용한다.
begin;
create schema if not exists report;
grant usage on schema report to authenticated,service_role;

create or replace function report.cellcare_reopen_report(p_report uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.weekly_reports;
begin
 select * into r from public.weekly_reports where id=p_report for update;
 if not found or not private.can_write_report(r.cell_id,r.week_start) then
   raise exception '이 보고서를 고칠 권한이 없습니다. 그 주 셀리더만 고칠 수 있습니다.' using errcode='42501';
 end if;
 if r.status::text<>'submitted' then raise exception '이미 고치는 중인 보고서입니다.'; end if;
 if r.review_status::text='reviewed' then
   update public.weekly_reports set status='draft',review_status='pending',reviewed_at=null,reviewed_by=null,version=version+1,updated_at=now() where id=p_report;
 else
   update public.weekly_reports set status='draft',version=version+1,updated_at=now() where id=p_report;
 end if;
 perform private.log_event(p_report,'reopened',jsonb_build_object('submission_no',r.submission_no,
   'was_reviewed',r.review_status::text='reviewed','reviewed_by',r.reviewed_by,'reviewed_at',r.reviewed_at));
 return r.version+1;
end $$;
revoke all on function report.cellcare_reopen_report(uuid) from public,anon;
grant execute on function report.cellcare_reopen_report(uuid) to authenticated;
commit;
