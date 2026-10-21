-- 셀 케어 전용. 운영 적용과 앱 배포는 별도 승인 후 DB부터 진행한다.
begin;
create schema if not exists report;
grant usage on schema report to authenticated,service_role;
create table report.cellcare_notification_items (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id),
 event_key text not null, title text not null, body text not null default '', url text not null,
 created_at timestamptz not null default now(), read_at timestamptz,
 unique(profile_id,event_key)
);
create index on report.cellcare_notification_items(profile_id,created_at desc);
alter table report.cellcare_notification_items enable row level security;
revoke all on report.cellcare_notification_items from public,anon,authenticated;

create table report.cellcare_comment_replies (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('report','note')),
 parent_id uuid not null,author_id uuid not null references public.profiles(id),
 content text not null check(char_length(btrim(content)) between 1 and 3000),
 created_at timestamptz not null default now(),deleted_at timestamptz,notified_at timestamptz
);
create index on report.cellcare_comment_replies(kind,parent_id,created_at);
alter table report.cellcare_comment_replies enable row level security;
revoke all on report.cellcare_comment_replies from public,anon,authenticated;

create function report.cellcare_route_allowed(p_url text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare rid uuid; cid uuid; k text; sid text;
begin
 if not exists(select 1 from public.profiles where id=private.current_profile_id() and active) then return false; end if;
 k := substring(p_url from '#(report|thread|note|notice)=');
 sid := substring(p_url from '#(?:report|thread|note|notice)=([0-9a-fA-F-]{36})(?:&|$)');
 if sid is not null then rid:=sid::uuid; end if;
 sid := substring(p_url from '[&]comment=([0-9a-fA-F-]{36})(?:&|$)');
 if sid is not null then cid:=sid::uuid; end if;
 if k='report' and rid is not null then
   if cid is not null then return exists(select 1 from public.senior_comments c where c.id=cid and c.report_id=rid and c.deleted_at is null and private.can_see_senior_comment(c.report_id,c.target)); end if;
   if p_url like '%&target=pastor_msg%' then return private.can_see_senior_comment(rid,'pastor_msg'); end if;
   return private.can_read_report(rid);
 elsif k='note' and rid is not null then return private.can_read_pastoral_note(rid);
 elsif k='thread' and rid is not null then return exists(select 1 from public.msg_participants where thread_id=rid and profile_id=private.current_profile_id());
 elsif k='notice' and rid is not null then return exists(select 1 from public.announcements n where n.id=rid and n.deleted_at is null);
 end if;
 sid:=substring(p_url from '#section=([a-z]+)$');
 return case sid when 'admin' then private.is_admin() when 'senior' then private.is_senior()
   when 'leadership' then private.has_role('leadership') when 'leader' then true when 'notifications' then true else false end;
exception when invalid_text_representation then return false;
end $$;

create function report.cellcare_notification_record(p_deliveries jsonb) returns void
language sql security definer set search_path='' as $$
 insert into report.cellcare_notification_items(profile_id,event_key,title,body,url)
 select distinct on(s.profile_id,coalesce(d->'payload'->>'notification_key',d->'payload'->>'tag')) s.profile_id,
 left(coalesce(d->'payload'->>'notification_key',d->'payload'->>'tag'),200),left(d->'payload'->>'title',300),left(coalesce(d->'payload'->>'body',''),4000),left(d->'payload'->>'url',500)
 from jsonb_array_elements(p_deliveries) d join public.push_subscriptions s on s.endpoint=d->>'endpoint'
 join public.profiles p on p.id=s.profile_id and p.active
 where nullif(d->'payload'->>'tag','') is not null and d->'payload'->>'url' like './#%'
 on conflict(profile_id,event_key) do nothing;
$$;
revoke all on function report.cellcare_notification_record(jsonb) from public,anon,authenticated;
grant execute on function report.cellcare_notification_record(jsonb) to service_role;

-- 기존 업무 데이터를 변경하지 않고 현재 본인에게 허용된 최근 알림을 모은다.
create function report.cellcare_sync_notifications() returns void
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
   union all select 'ncmt-'||c.id,'성도 동정에 코멘트가 달렸습니다',c.content,'./#note='||c.note_id||'&comment='||c.id,c.created_at
   from public.pastoral_note_comments c where c.deleted_at is null and c.author_id<>private.current_profile_id() and private.can_read_pastoral_note(c.note_id)
   union all select 'note-'||n.id,'성도 동정이 공유되었습니다','성도 동정을 열어 내용을 확인해 주세요.','./#note='||n.id,n.created_at
   from public.pastoral_notes n where n.active and n.author_id<>private.current_profile_id() and private.can_read_pastoral_note(n.id)
   union all select 'submit-'||r.id||'-'||r.submission_no,'셀 보고서가 제출되었습니다','보고서를 열어 내용을 확인해 주세요.','./#report='||r.id,r.submitted_at
   from public.weekly_reports r where r.status='submitted' and r.submitted_by<>private.current_profile_id() and private.can_read_report(r.id)
   and (r.reviewer_user_id=private.current_profile_id() or private.is_cell_leadership(r.cell_id) or (r.review_mode='senior_direct' and private.is_senior()))
 ) e where e.created_at>=now()-interval '30 days'
 and exists(select 1 from public.profiles where id=private.current_profile_id() and active)
 on conflict(profile_id,event_key) do nothing;
$$;
revoke all on function report.cellcare_sync_notifications() from public,anon,authenticated;
create function report.cellcare_notification_list() returns table(id uuid,title text,body text,url text,created_at timestamptz,read_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 perform report.cellcare_sync_notifications();
 return query
 select n.id,n.title,n.body,n.url,n.created_at,n.read_at from report.cellcare_notification_items n
 where n.profile_id=private.current_profile_id() and report.cellcare_route_allowed(n.url)
 and (n.event_key not like 'reply-%' or exists(select 1 from report.cellcare_comment_replies r where 'reply-'||r.id=n.event_key and r.deleted_at is null))
 order by n.created_at desc,n.id desc limit 100;
end;
$$;
create function report.cellcare_notification_read(p_id uuid default null) returns void
language sql security definer set search_path='' as $$
 update report.cellcare_notification_items n set read_at=coalesce(n.read_at,now())
 where n.profile_id=private.current_profile_id() and (p_id is null or n.id=p_id) and report.cellcare_route_allowed(n.url);
$$;

create function report.cellcare_reply_allowed(p_kind text,p_parent uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=private.current_profile_id() and active) and
 case p_kind when 'report' then exists(select 1 from public.senior_comments c where c.id=p_parent and c.deleted_at is null and private.can_see_senior_comment(c.report_id,c.target))
 when 'note' then exists(select 1 from public.pastoral_note_comments c where c.id=p_parent and c.deleted_at is null and private.can_read_pastoral_note(c.note_id)) else false end;
$$;
create function report.cellcare_reply_list(p_kind text,p_parents uuid[]) returns table(id uuid,parent_id uuid,author_name text,content text,created_at timestamptz,mine boolean)
language sql stable security definer set search_path='' as $$
 select r.id,r.parent_id,p.name,r.content,r.created_at,r.author_id=private.current_profile_id()
 from report.cellcare_comment_replies r join public.profiles p on p.id=r.author_id
 where r.kind=p_kind and r.parent_id=any(p_parents) and r.deleted_at is null and report.cellcare_reply_allowed(r.kind,r.parent_id)
 order by r.created_at,r.id;
$$;
create function report.cellcare_reply_add(p_kind text,p_parent uuid,p_content text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; recipient uuid; destination text;
begin
 if not report.cellcare_reply_allowed(p_kind,p_parent) then raise exception '이 코멘트에 답글을 쓸 권한이 없습니다.' using errcode='42501'; end if;
 insert into report.cellcare_comment_replies(kind,parent_id,author_id,content) values(p_kind,p_parent,private.current_profile_id(),btrim(p_content)) returning id into result;
 if p_kind='report' then select c.author_id,'./#report='||c.report_id||'&comment='||c.id into recipient,destination from public.senior_comments c where c.id=p_parent;
 else select c.author_id,'./#note='||c.note_id||'&comment='||c.id into recipient,destination from public.pastoral_note_comments c where c.id=p_parent; end if;
 insert into report.cellcare_notification_items(profile_id,event_key,title,body,url)
 select recipient,'reply-'||result,'코멘트에 답글이 달렸습니다',btrim(p_content),destination
 where recipient<>private.current_profile_id() and exists(select 1 from public.profiles where id=recipient and active);
 return result;
end $$;
create function report.cellcare_reply_delete(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update report.cellcare_comment_replies r set deleted_at=now() where r.id=p_id and r.author_id=private.current_profile_id() and report.cellcare_reply_allowed(r.kind,r.parent_id);
 if not found then raise exception '답글을 지울 권한이 없습니다.' using errcode='42501'; end if;
end $$;

create function report.cellcare_comment_destination(p_kind text,p_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select './#report='||c.report_id||'&comment='||c.id from public.senior_comments c where p_kind='report' and c.id=p_id and c.deleted_at is null
 union all select './#note='||c.note_id||'&comment='||c.id from public.pastoral_note_comments c where p_kind='note' and c.id=p_id and c.deleted_at is null;
$$;
create function report.cellcare_reply_push_targets(p_reply uuid,p_auth_user uuid) returns table(endpoint text,p256dh text,auth text,lang text,url text)
language plpgsql security definer set search_path='' as $$
declare r report.cellcare_comment_replies;
begin
 select x.* into r from report.cellcare_comment_replies x join public.profiles p on p.id=x.author_id
 where x.id=p_reply and x.deleted_at is null and x.notified_at is null and x.created_at>now()-interval '10 minutes' and p.auth_user_id=p_auth_user and p.active for update of x;
 if not found then return; end if;
 update report.cellcare_comment_replies set notified_at=now() where id=r.id;
 return query select s.endpoint,s.p256dh,s.auth,s.lang,n.url from report.cellcare_notification_items n
 join public.profiles p on p.id=n.profile_id and p.active join public.push_subscriptions s on s.profile_id=p.id
 where n.event_key='reply-'||r.id;
end $$;

revoke all on function report.cellcare_notification_list(),report.cellcare_notification_read(uuid),report.cellcare_reply_list(text,uuid[]),report.cellcare_reply_add(text,uuid,text),report.cellcare_reply_delete(uuid) from public,anon;
grant execute on function report.cellcare_notification_list(),report.cellcare_notification_read(uuid),report.cellcare_reply_list(text,uuid[]),report.cellcare_reply_add(text,uuid,text),report.cellcare_reply_delete(uuid) to authenticated;
revoke all on function report.cellcare_comment_destination(text,uuid),report.cellcare_reply_push_targets(uuid,uuid) from public,anon,authenticated;
grant execute on function report.cellcare_comment_destination(text,uuid),report.cellcare_reply_push_targets(uuid,uuid) to service_role;
revoke all on function report.cellcare_reply_allowed(text,uuid),report.cellcare_route_allowed(text) from public,anon,authenticated;
create function report.cellcare_notification_can_open(p_url text) returns boolean
language sql stable security definer set search_path='' as $$ select report.cellcare_route_allowed(p_url); $$;
revoke all on function report.cellcare_notification_can_open(text) from public,anon;
grant execute on function report.cellcare_notification_can_open(text) to authenticated;

-- 기기 구독 없이도 업무 알림은 기록한다. 열람 시에는 원본의 현재 권한을 다시 검사한다.
create function report.cellcare_notification_detail(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not report.cellcare_route_allowed('./#'||p_kind||'='||p_id) then raise exception '알림 내용을 볼 권한이 없거나 삭제된 내용입니다.' using errcode='42501'; end if;
 if p_kind='note' then
   select jsonb_build_object('id',n.id,'person_name',n.person_name,'content',n.content,'prayer',n.prayer,'created_at',n.created_at,'author_name',p.name)
   into result from public.pastoral_notes n join public.profiles p on p.id=n.author_id where n.id=p_id;
 elsif p_kind='notice' then
   select jsonb_build_object('id',n.id,'title',n.title,'body',n.body,'created_at',n.created_at,'author_name',p.name)
   into result from public.announcements n join public.profiles p on p.id=n.author_id where n.id=p_id;
 else raise exception 'invalid notification kind'; end if;
 return result;
end $$;
revoke all on function report.cellcare_notification_detail(text,uuid) from public,anon;
grant execute on function report.cellcare_notification_detail(text,uuid) to authenticated;
commit;
