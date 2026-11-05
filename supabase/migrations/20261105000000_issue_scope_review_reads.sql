-- 셀원 이슈 「내 분파」 성도 동정 거르기 · 확인한 보고서의 제출 알림 읽음 정리 (2026-11-05)
--   1) 운영 public.issue_board(2026-11-05 운영에서 읽음)는 「내 분파」에서도 볼 수 있는 성도 동정을 모두 넣는다.
--      성도 동정에는 셀·셀원 연결이 없어(person_name만) public은 그대로 두고 report 스키마에 감싸는 함수를 둔다.
--      「내 분파」의 성도 동정은 ① 내가 쓴 것(my_area) ② 이름(띄어쓰기 무시)이 내 담당 셀 셀원과 같은 것만 남긴다.
--      교회 전체·담임 목사님·사모님은 그대로. 셀보고서 기록은 원래 함수가 이미 거른다.
--   2) 상세 화면을 열지 않고 「확인 완료」·「확인했습니다」를 누른 보고서의 제출 알림이 안 읽음으로 남아 있다.
--      앞으로는 앱이 확인 뒤 cellcare_report_open을 부른다. 이미 남은 것은 여기서 한 번 정리한다:
--      받은 분 본인이 그 알림 뒤에 확인(report_events 'reviewed')했거나 「확인했습니다」(cellcare_senior_acks)를 누른 보고서만.
-- 여러 번 실행해도 안전하다. 앱보다 먼저 적용한다.
begin;
create schema if not exists report;
grant usage on schema report to authenticated,service_role;

create or replace function report.cellcare_issue_board(p_weeks integer default 8,p_scope text default 'mine')
returns table(source text,item_id uuid,on_date date,week_start date,cell_id uuid,cell_name text,resp_name text,person_id uuid,person_name text,
 category text,content text,attention boolean,related_member_id uuid,related_name text,relation_kind text,author_name text,my_area boolean,categories text[],campus text)
language sql stable security definer set search_path='' as $$
 select b.* from public.issue_board(p_weeks,p_scope) b
 where b.source<>'note' or coalesce(p_scope,'mine')='all' or private.is_senior() or b.my_area
    or exists(select 1 from public.cell_members m
              where m.active and m.deleted_at is null and (m.left_at is null or m.left_at>=b.on_date)
                and replace(m.name,' ','')=replace(coalesce(b.person_name,''),' ','')
                and private.is_cell_leadership(m.cell_id))
$$;
revoke all on function report.cellcare_issue_board(integer,text) from public,anon;
grant execute on function report.cellcare_issue_board(integer,text) to authenticated;

update report.cellcare_notification_items n set read_at=now()
where n.read_at is null and n.kind in ('REPORT_SUBMITTED','REPORT_UPDATED') and n.report_id is not null
  and (exists(select 1 from public.report_events e where e.report_id=n.report_id and e.actor_id=n.profile_id and e.action::text='reviewed' and e.created_at>=n.created_at)
    or exists(select 1 from report.cellcare_senior_acks a where a.kind='report' and a.target_id=n.report_id and a.profile_id=n.profile_id and a.acked_at>=n.created_at));
commit;
