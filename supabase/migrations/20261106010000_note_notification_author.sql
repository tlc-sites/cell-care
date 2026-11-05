-- 성도 동정 알림에 쓴 분 이름 (2026-11-06)
--   알림함에서 성도 동정 공유(note-)와 동정 코멘트(ncmt-) 알림에도 author_name을 돌려준다(지금 프로필 이름).
--   돌려주는 칸은 그대로라 create or replace. 본문은 20261026000000과 같고 author_name 계산만 늘었다.
-- 기존 업무 테이블(public)은 읽기만 한다. 여러 번 실행해도 안전하다. 앱보다 먼저 적용한다(앱은 이름이 없으면 예전처럼 보인다).
begin;
create or replace function report.cellcare_notification_list() returns table(id uuid,title text,body text,url text,created_at timestamptz,read_at timestamptz,
 kind text,report_id uuid,cell_name text,author_name text,week_start date)
language plpgsql security definer set search_path='' as $$
begin
 perform report.cellcare_sync_notifications();
 return query
 select n.id,n.title,n.body,n.url,n.created_at,n.read_at,n.kind,n.report_id,
 case when n.kind is null then null else coalesce(nullif(btrim(c.name),''),nullif(btrim(n.cell_name),''),'셀 정보 없음') end,
 case when n.kind is not null then coalesce(nullif(btrim(p.name),''),nullif(btrim(n.author_name),''),'작성자 정보 없음')
      when n.event_key like 'note-%' then (select nullif(btrim(ap.name),'') from public.pastoral_notes x join public.profiles ap on ap.id=x.author_id where x.id::text=substr(n.event_key,6))
      when n.event_key like 'ncmt-%' then (select nullif(btrim(ap.name),'') from public.pastoral_note_comments x join public.profiles ap on ap.id=x.author_id where x.id::text=substr(n.event_key,6))
 end,
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
commit;
