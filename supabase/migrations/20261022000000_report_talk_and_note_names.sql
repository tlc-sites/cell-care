-- 셀 케어 전용. 운영 적용과 앱 배포는 별도 승인 후 DB부터 진행한다.
-- 1) 주차별 셀 보고서에 담당 교역자 ↔ 셀리더 대화(report.cellcare_report_talk)
-- 2) 알림함의 성도 동정 알림 제목에 성도 이름 표시
-- public 객체와 원본 행은 바꾸지 않는다. 여러 번 실행해도 같은 결과가 되도록 쓴다.
begin;

create table if not exists report.cellcare_report_talk (
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null,
 author_id uuid not null references public.profiles(id),
 author_role text not null check(author_role in ('leader','leadership')),
 content text not null check(char_length(btrim(content)) between 1 and 3000),
 created_at timestamptz not null default now(), deleted_at timestamptz, notified_at timestamptz
);
create index if not exists cellcare_report_talk_report_idx on report.cellcare_report_talk(report_id,created_at);
alter table report.cellcare_report_talk enable row level security;
revoke all on report.cellcare_report_talk from public,anon,authenticated;

-- 그 주(또는 지금) 이 셀의 셀리더인가
create or replace function report.cellcare_talk_is_leader(p_report uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.weekly_reports r join public.cell_leaders l on l.cell_id=r.cell_id
   where r.id=p_report and l.user_id=private.current_profile_id()
   and ((l.start_date<=r.week_start+6 and (l.end_date is null or l.end_date>=r.week_start))
     or (l.start_date<=private.app_today() and (l.end_date is null or l.end_date>=private.app_today()))));
$$;
-- 대화에 들어올 수 있는 분: 보고서를 읽을 수 있는 활성 사용자 중 셀리더, 이 셀의 담당 교역자, 확인 책임자.
-- 제출(또는 한 번이라도 제출)된 보고서에만 연다.
create or replace function report.cellcare_talk_role(p_report uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
   when not exists(select 1 from public.profiles where id=private.current_profile_id() and active) then null
   when not exists(select 1 from public.weekly_reports r where r.id=p_report and (r.status='submitted' or r.submitted_at is not null)) then null
   when not private.can_read_report(p_report) then null
   when report.cellcare_talk_is_leader(p_report) then 'leader'
   when exists(select 1 from public.weekly_reports r where r.id=p_report
     and (private.is_cell_leadership(r.cell_id) or r.reviewer_user_id=private.current_profile_id())) then 'leadership'
   end;
$$;

create or replace function report.cellcare_talk_list(p_report uuid)
returns table(id uuid,author_name text,author_role text,content text,created_at timestamptz,mine boolean)
language sql stable security definer set search_path='' as $$
 select t.id,p.name,t.author_role,t.content,t.created_at,t.author_id=private.current_profile_id()
 from report.cellcare_report_talk t join public.profiles p on p.id=t.author_id
 where t.report_id=p_report and t.deleted_at is null and report.cellcare_talk_role(p_report) is not null
 order by t.created_at,t.id;
$$;

create or replace function report.cellcare_talk_add(p_report uuid,p_content text) returns uuid
language plpgsql security definer set search_path='' as $$
declare me uuid := private.current_profile_id(); my_role text; result uuid; cell uuid; wk date; reviewer uuid; cname text;
begin
 my_role := report.cellcare_talk_role(p_report);
 if my_role is null then raise exception '이 보고서에 대화를 남길 권한이 없습니다.' using errcode='42501'; end if;
 insert into report.cellcare_report_talk(report_id,author_id,author_role,content)
 values(p_report,me,my_role,btrim(p_content)) returning id into result;
 select r.cell_id,r.week_start,r.reviewer_user_id,c.name into cell,wk,reviewer,cname
 from public.weekly_reports r left join public.cells c on c.id=r.cell_id where r.id=p_report;
 -- 셀리더가 쓰면 담당 교역자·확인 책임자에게, 교역자가 쓰면 셀리더에게. 앞서 대화에 참여한 분에게도.
 insert into report.cellcare_notification_items(profile_id,event_key,title,body,url)
 select distinct x.pid,'talk-'||result,
   case when my_role='leader' then '셀리더가 보고서 대화에 답했습니다' else '담당 교역자가 보고서에 대화를 남겼습니다' end
     ||coalesce(' · '||cname,''),
   btrim(p_content),'./#report='||p_report||'&talk='||result
 from (
   select l.user_id pid from public.cell_leaders l where my_role='leadership' and l.cell_id=cell
     and l.start_date<=greatest(private.app_today(),wk+6) and (l.end_date is null or l.end_date>=least(private.app_today(),wk))
   union select a.leadership_user_id from public.leadership_assignments a where my_role='leader' and a.cell_id=cell
     and a.start_date<=private.app_today() and (a.end_date is null or a.end_date>=private.app_today())
   union select reviewer where my_role='leader' and reviewer is not null
   union select t.author_id from report.cellcare_report_talk t where t.report_id=p_report and t.deleted_at is null
 ) x join public.profiles p on p.id=x.pid and p.active
 where x.pid<>me
 on conflict(profile_id,event_key) do nothing;
 return result;
end $$;

create or replace function report.cellcare_talk_delete(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update report.cellcare_report_talk t set deleted_at=now()
 where t.id=p_id and t.deleted_at is null and t.author_id=private.current_profile_id() and report.cellcare_talk_role(t.report_id) is not null;
 if not found then raise exception '이 대화를 지울 권한이 없습니다.' using errcode='42501'; end if;
end $$;

-- 서버(푸시 발송) 전용: 쓴 본인이 10분 안에 한 번만
create or replace function report.cellcare_talk_push_targets(p_talk uuid,p_auth_user uuid)
returns table(endpoint text,p256dh text,auth text,lang text,url text,title text,body text)
language plpgsql security definer set search_path='' as $$
declare t report.cellcare_report_talk;
begin
 select x.* into t from report.cellcare_report_talk x join public.profiles p on p.id=x.author_id
 where x.id=p_talk and x.deleted_at is null and x.notified_at is null and x.created_at>now()-interval '10 minutes'
   and p.auth_user_id=p_auth_user and p.active for update of x;
 if not found then return; end if;
 update report.cellcare_report_talk set notified_at=now() where id=t.id;
 return query select s.endpoint,s.p256dh,s.auth,s.lang,n.url,n.title,n.body from report.cellcare_notification_items n
 join public.profiles p on p.id=n.profile_id and p.active join public.push_subscriptions s on s.profile_id=p.id
 where n.event_key='talk-'||t.id;
end $$;

-- 성도 동정 알림 제목에 성도 이름을 넣는다 (나머지는 20261021010000과 같다).
create or replace function report.cellcare_sync_notifications() returns void
language sql security definer set search_path='' as $$
 insert into report.cellcare_notification_items(profile_id,event_key,title,body,url,created_at)
 select private.current_profile_id(),e.event_key,left(e.title,300),left(coalesce(e.body,''),4000),e.url,e.created_at
 from (
   select 'msg-'||m.thread_id||'-'||m.id event_key,'새 메시지가 도착했습니다' title,m.body,'./#thread='||m.thread_id url,m.created_at
   from public.msg_posts m where m.author_id<>private.current_profile_id()
   and exists(select 1 from public.msg_participants p where p.thread_id=m.thread_id and p.profile_id=private.current_profile_id())
   union all select 'notice-'||n.id,n.title,n.body,'./#notice='||n.id,n.created_at
   from public.announcements n where n.deleted_at is null and n.author_id<>private.current_profile_id()
   union all select 'cmt-'||c.id,'보고서에 코멘트가 달렸습니다',c.content,'./#report='||c.report_id||'&comment='||c.id,c.created_at
   from public.senior_comments c where c.deleted_at is null and c.author_id<>private.current_profile_id() and private.can_see_senior_comment(c.report_id,c.target)
   union all select 'ncmt-'||c.id,'[성도 동정] '||coalesce(nullif(btrim(n.person_name),''),'이름 없음')||' · 코멘트가 달렸습니다',c.content,'./#note='||c.note_id||'&comment='||c.id,c.created_at
   from public.pastoral_note_comments c join public.pastoral_notes n on n.id=c.note_id
   where c.deleted_at is null and c.author_id<>private.current_profile_id() and private.can_read_pastoral_note(c.note_id)
   union all select 'note-'||n.id,'[성도 동정] '||coalesce(nullif(btrim(n.person_name),''),'이름 없음'),
     coalesce(nullif(btrim(n.person_name),''),'이름 없음')||'님의 성도 동정이 공유되었습니다. 열어서 내용을 확인해 주세요.','./#note='||n.id,n.created_at
   from public.pastoral_notes n where n.active and n.author_id<>private.current_profile_id() and private.can_read_pastoral_note(n.id)
   union all select 'submit-'||r.id||'-'||r.submission_no,'셀 보고서가 제출되었습니다','보고서를 열어 내용을 확인해 주세요.','./#report='||r.id,r.submitted_at
   from public.weekly_reports r where r.status='submitted' and r.submitted_by<>private.current_profile_id() and private.can_read_report(r.id)
   and (r.reviewer_user_id=private.current_profile_id() or private.is_cell_leadership(r.cell_id) or (r.review_mode='senior_direct' and private.is_senior()))
 ) e where e.created_at>=now()-interval '30 days'
 and exists(select 1 from public.profiles where id=private.current_profile_id() and active)
 on conflict(profile_id,event_key) do nothing;
$$;
revoke all on function report.cellcare_sync_notifications() from public,anon,authenticated;

-- 지운 대화의 알림은 목록에서 숨긴다.
create or replace function report.cellcare_notification_list() returns table(id uuid,title text,body text,url text,created_at timestamptz,read_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 perform report.cellcare_sync_notifications();
 return query
 select n.id,n.title,n.body,n.url,n.created_at,n.read_at from report.cellcare_notification_items n
 where n.profile_id=private.current_profile_id() and report.cellcare_route_allowed(n.url)
 and (n.event_key not like 'reply-%' or exists(select 1 from report.cellcare_comment_replies r where 'reply-'||r.id=n.event_key and r.deleted_at is null))
 and (n.event_key not like 'talk-%' or exists(select 1 from report.cellcare_report_talk t where 'talk-'||t.id=n.event_key and t.deleted_at is null))
 order by n.created_at desc,n.id desc limit 100;
end;
$$;

-- 이미 쌓인 성도 동정 알림(푸시 기록 포함)의 제목도 이름이 보이게 고친다. 읽음 상태와 내용 연결은 그대로 둔다.
update report.cellcare_notification_items i
set title=left('[성도 동정] '||coalesce(nullif(btrim(n.person_name),''),'이름 없음'),300)
from public.pastoral_notes n
where i.event_key='note-'||n.id and i.title not like '[성도 동정]%';
update report.cellcare_notification_items i
set title=left('[성도 동정] '||coalesce(nullif(btrim(n.person_name),''),'이름 없음')||' · 코멘트가 달렸습니다',300)
from public.pastoral_note_comments c join public.pastoral_notes n on n.id=c.note_id
where i.event_key='ncmt-'||c.id and i.title not like '[성도 동정]%';

revoke all on function report.cellcare_talk_is_leader(uuid),report.cellcare_talk_role(uuid) from public,anon,authenticated;
revoke all on function report.cellcare_talk_list(uuid),report.cellcare_talk_add(uuid,text),report.cellcare_talk_delete(uuid),report.cellcare_notification_list() from public,anon;
grant execute on function report.cellcare_talk_list(uuid),report.cellcare_talk_add(uuid,text),report.cellcare_talk_delete(uuid),report.cellcare_notification_list() to authenticated;
revoke all on function report.cellcare_talk_push_targets(uuid,uuid) from public,anon,authenticated;
grant execute on function report.cellcare_talk_push_targets(uuid,uuid) to service_role;
commit;
