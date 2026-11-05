-- 작성 중 셀보고서 삭제 (2026-11-05 요청, 주중 교회 보고서의 「이 임시저장 보고 삭제」와 같은 기능)
--   지울 수 있는 것: 한 번도 제출하지 않은(submission_no=0) 작성 중(draft) 보고서. 제출했다가 고치는 중인 보고서는 지우지 않는다.
--   지울 수 있는 분: 그 주 보고서를 쓸 수 있는 분(private.can_write_report — 셀리더, 대신 쓰는 담당 교역자).
--   보고서에 딸린 기록(출석·셀 케어 등)은 운영 DB의 외래 키 규칙(on delete cascade 등)대로 함께 지워진다.
--   외래 키가 삭제를 막으면 아무것도 지우지 않고(한 덩어리로 되돌림) 어떤 기록 때문인지 알려 준다.
--   누가 언제 무엇을 지웠는지는 report.cellcare_deleted_reports에 보고서 줄 그대로 남긴다(관리용, 화면에서는 읽지 않음).
-- public 테이블·함수는 바꾸지 않는다. 여러 번 실행해도 안전하다. 앱보다 먼저 적용한다.
begin;
create schema if not exists report;
grant usage on schema report to authenticated,service_role;

create table if not exists report.cellcare_deleted_reports(
 report_id uuid primary key,
 cell_id uuid,
 week_start date,
 deleted_by uuid,
 deleted_at timestamptz not null default now(),
 snapshot jsonb not null);
alter table report.cellcare_deleted_reports enable row level security;
revoke all on report.cellcare_deleted_reports from public,anon,authenticated;

create or replace function report.cellcare_delete_draft_report(p_report uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.weekly_reports; blocker text;
begin
 select * into r from public.weekly_reports where id=p_report for update;
 if not found or not private.can_write_report(r.cell_id,r.week_start) then
   raise exception '이 보고서를 지울 권한이 없습니다. 그 주 셀리더나 담당 교역자만 지울 수 있습니다.' using errcode='42501';
 end if;
 if r.status::text<>'draft' or coalesce(r.submission_no,0)>0 then
   raise exception '한 번도 제출하지 않은 작성 중 보고서만 지울 수 있습니다.' using errcode='22023';
 end if;
 insert into report.cellcare_deleted_reports(report_id,cell_id,week_start,deleted_by,snapshot)
 values(r.id,r.cell_id,r.week_start,private.current_profile_id(),to_jsonb(r))
 on conflict(report_id) do update set deleted_by=excluded.deleted_by,deleted_at=now(),snapshot=excluded.snapshot;
 begin
   delete from public.weekly_reports where id=p_report;
 exception when foreign_key_violation then
   get stacked diagnostics blocker = table_name;
   raise exception '이 보고서에 연결된 기록(%) 때문에 지우지 못했습니다. 관리자에게 알려 주세요.', blocker using errcode='23503';
 end;
end $$;
revoke all on function report.cellcare_delete_draft_report(uuid) from public,anon;
grant execute on function report.cellcare_delete_draft_report(uuid) to authenticated;
commit;
