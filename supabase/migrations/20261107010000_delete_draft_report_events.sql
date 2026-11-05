-- 작성 중 셀보고서 삭제 보완 (2026-11-05)
--   운영에서 public.report_events(보고서 이력: 만들기·저장 등)의 외래 키가 보고서 삭제를 막았다.
--   이력은 지우기 전에 report.cellcare_deleted_reports.events에 그대로 옮겨 담고, 그 보고서의 이력만 지운다.
--   그 밖의 기록이 막으면 예전처럼 아무것도 지우지 않고 막은 테이블 이름을 알려 준다.
-- 20261107000000 뒤에 실행한다. 여러 번 실행해도 안전하다.
begin;
alter table report.cellcare_deleted_reports add column if not exists events jsonb;

create or replace function report.cellcare_delete_draft_report(p_report uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.weekly_reports; blocker text; ev jsonb;
begin
 select * into r from public.weekly_reports where id=p_report for update;
 if not found or not private.can_write_report(r.cell_id,r.week_start) then
   raise exception '이 보고서를 지울 권한이 없습니다. 그 주 셀리더나 담당 교역자만 지울 수 있습니다.' using errcode='42501';
 end if;
 if r.status::text<>'draft' or coalesce(r.submission_no,0)>0 then
   raise exception '한 번도 제출하지 않은 작성 중 보고서만 지울 수 있습니다.' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) into ev from public.report_events e where e.report_id=p_report;
 insert into report.cellcare_deleted_reports(report_id,cell_id,week_start,deleted_by,snapshot,events)
 values(r.id,r.cell_id,r.week_start,private.current_profile_id(),to_jsonb(r),ev)
 on conflict(report_id) do update set deleted_by=excluded.deleted_by,deleted_at=now(),snapshot=excluded.snapshot,events=excluded.events;
 begin
   delete from public.report_events where report_id=p_report;
   delete from public.weekly_reports where id=p_report;
 exception when foreign_key_violation then
   get stacked diagnostics blocker = table_name;
   raise exception '이 보고서에 연결된 기록(%) 때문에 지우지 못했습니다. 관리자에게 알려 주세요.', blocker using errcode='23503';
 end;
end $$;
revoke all on function report.cellcare_delete_draft_report(uuid) from public,anon;
grant execute on function report.cellcare_delete_draft_report(uuid) to authenticated;
commit;
