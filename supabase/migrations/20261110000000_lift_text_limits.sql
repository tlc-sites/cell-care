-- 셀케어 긴 글의 글자 수 제한 없애기 (2026-11-10 요청: 「글자수 제한이 있다면 풀어줘」, 상한 없이)
--   public 영역도 이 길이 제한만 바꾸도록 사용자가 허락했다(2026-11-10).
--   표: 상한만 없애고 「비어 있으면 안 됨」은 그대로. 이름·제목·장소·시간처럼 짧은 칸은 그대로.
--   함수: 운영 본문(2026-11-10 운영에서 읽음)과 같고, 긴 글을 거부하거나 자르던 부분만 뺐다.
--     lr_save(요약·내용 4000) · msg_post/msg_start(4000 거부) · note_comment_add(3000) · notice_create(본문 3000)
--     pastor_msg_save(4000) · review_update(4000) · save_report(셀리더 메시지 메모·기도제목 2000) · senior_comment_add(3000)
--   TLC 보고 앱이 쓰는 report 영역 표는 건드리지 않는다(셀케어 cellcare_* 표만).
-- 여러 번 실행해도 안전하다. 앱보다 먼저 적용한다(앱이 먼저 나가도 긴 글만 예전처럼 거부·잘림).
begin;

alter table public.announcements drop constraint if exists announcements_body_check;
alter table public.msg_posts drop constraint if exists msg_posts_body_check;
alter table public.msg_posts add constraint msg_posts_body_check check (char_length(body) >= 1);
alter table public.pastoral_notes drop constraint if exists pastoral_notes_content_check;
alter table public.pastoral_notes add constraint pastoral_notes_content_check check (char_length(content) >= 1);
alter table public.pastoral_notes drop constraint if exists pastoral_notes_prayer_check;
alter table report.cellcare_comment_replies drop constraint if exists cellcare_comment_replies_content_check;
alter table report.cellcare_comment_replies add constraint cellcare_comment_replies_content_check check (char_length(btrim(content)) >= 1);
alter table report.cellcare_report_talk drop constraint if exists cellcare_report_talk_content_check;
alter table report.cellcare_report_talk add constraint cellcare_report_talk_content_check check (char_length(btrim(content)) >= 1);
alter table report.cellcare_member_moves drop constraint if exists cellcare_member_moves_memo_check;

CREATE OR REPLACE FUNCTION public.lr_save(p_week date, p_summary text, p_items jsonb, p_submit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare me uuid := private.current_profile_id(); w date := private.week_start_of(p_week); r leadership_reports; it jsonb; pp record; n int := 0;
begin
  if not private.has_role('leadership') then raise exception '분파리더만 교역자 보고를 쓸 수 있습니다.'; end if;
  if w > private.week_start_of(private.app_today()) or w < private.week_start_of(private.app_today()) - 28 then
    raise exception '이번 주와 지난 4주까지만 쓸 수 있습니다.';
  end if;
  insert into leadership_reports (author_id, week_start) values (me, w) on conflict (author_id, week_start) do nothing;
  select * into r from leadership_reports where author_id = me and week_start = w for update;
  delete from leadership_report_items where report_id = r.id;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce(btrim(it->>'content'), '') = '' then continue; end if;
    select * into pp from private.lr_people(me, w) x where x.kind = it->>'kind' and x.id = (it->>'person_id')::uuid limit 1;
    if pp.id is null then raise exception '맡으신 분만 보고에 넣을 수 있습니다. (%)', coalesce(it->>'person_name', ''); end if;
    insert into leadership_report_items (report_id, member_id, individual_id, leader_id, person_name, group_name, category, content, sort)
    values (r.id, case when pp.kind = 'member' then pp.id end, case when pp.kind = 'individual' then pp.id end,
            case when pp.kind = 'leader' then pp.id end,
            pp.name, pp.group_name, coalesce(nullif(it->>'category', ''), 'update'), btrim(it->>'content'), n);
    n := n + 1;
  end loop;
  if coalesce(p_submit, false) and n = 0 and coalesce(btrim(p_summary), '') = '' then
    raise exception '한 분 이상 적거나 한 주 요약을 적어 주세요.';
  end if;
  update leadership_reports set
    summary = nullif(btrim(coalesce(p_summary, '')), ''),
    status = case when coalesce(p_submit, false) or r.status = 'submitted' then 'submitted' else 'draft' end,
    submitted_at = case when coalesce(p_submit, false) or r.status = 'submitted' then now() else submitted_at end,
    first_submitted_at = case when coalesce(p_submit, false) or r.status = 'submitted' then coalesce(first_submitted_at, now()) else first_submitted_at end,
    updated_at = now()
   where id = r.id;
  return private.lr_json(r.id);
end $function$;

CREATE OR REPLACE FUNCTION public.msg_post(p_thread uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare me uuid := private.current_profile_id(); v_body text := btrim(coalesce(p_body, '')); v_post uuid;
begin
  if not private.msg_is_member(p_thread) then raise exception '이 대화를 찾을 수 없습니다.'; end if;
  if v_body = '' then raise exception '보낼 내용을 적어 주세요.'; end if;
  insert into msg_posts (thread_id, author_id, body) values (p_thread, me, v_body) returning id into v_post;
  update msg_threads set last_at = now() where id = p_thread;
  update msg_participants set last_read_at = now() where thread_id = p_thread and profile_id = me;
  return v_post;
end $function$;

CREATE OR REPLACE FUNCTION public.msg_start(p_to uuid[], p_body text, p_report uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare me uuid := private.current_profile_id(); v_body text := btrim(coalesce(p_body, '')); t uuid; pid uuid; r weekly_reports; v_post uuid;
begin
  if me is null then raise exception '로그인이 필요합니다.'; end if;
  if v_body = '' then raise exception '보낼 내용을 적어 주세요.'; end if;
  if coalesce(array_length(p_to, 1), 0) = 0 then raise exception '받는 분을 골라 주세요.'; end if;
  if array_length(p_to, 1) > 20 then raise exception '한 번에 20분까지 보낼 수 있습니다.'; end if;
  foreach pid in array p_to loop
    if not private.msg_can_send_to(pid) then raise exception '메시지를 보낼 수 없는 분이 들어 있습니다. 화면을 새로고침해 주세요.'; end if;
  end loop;
  if p_report is not null then
    select * into r from weekly_reports where id = p_report;
    if r.id is null or r.status <> 'submitted' or not private.was_cell_leader_in_week(r.cell_id, r.week_start) then
      raise exception '직접 제출한 셀보고서만 함께 보낼 수 있습니다.';
    end if;
  end if;
  insert into msg_threads (created_by, report_id) values (me, p_report) returning id into t;
  insert into msg_participants (thread_id, profile_id, last_read_at) values (t, me, now());
  insert into msg_participants (thread_id, profile_id) select t, x from (select distinct unnest(p_to) as x) u where x <> me;
  insert into msg_posts (thread_id, author_id, body) values (t, me, v_body) returning id into v_post;
  return jsonb_build_object('thread', t, 'post', v_post);
end $function$;

CREATE OR REPLACE FUNCTION public.note_comment_add(p_note uuid, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v text := nullif(btrim(coalesce(p_content, '')), ''); v_id uuid;
begin
  if not (private.is_senior() or private.has_role('leadership')) then raise exception '담임 목사님·사모님과 교역자만 코멘트를 남길 수 있습니다.'; end if;
  if v is null then raise exception '코멘트를 적어 주세요.'; end if;
  if not exists (select 1 from pastoral_notes where id = p_note and active) or not private.can_read_pastoral_note(p_note) then
    raise exception '동정을 찾지 못했습니다.';
  end if;
  insert into pastoral_note_comments (note_id, author_id, content)
  values (p_note, private.current_profile_id(), v) returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.notice_create(p_title text, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v uuid;
begin
  if not private.can_post_notice() then raise exception '교역자, 담임 목사님·사모님, 관리자만 공지를 올릴 수 있습니다.'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception '공지 제목을 적어 주세요.'; end if;
  insert into announcements (author_id, title, body)
  values (private.current_profile_id(), left(btrim(p_title), 80), btrim(coalesce(p_body, ''))) returning id into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.pastor_msg_save(p_report uuid, p_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r weekly_reports; v text := nullif(btrim(coalesce(p_content, '')), '');
begin
  select * into r from weekly_reports where id = p_report;
  if not found or not private.can_write_report(r.cell_id, r.week_start) then
    raise exception '그 주 셀리더만 쓸 수 있습니다.';
  end if;
  if r.status = 'submitted' then raise exception '제출한 보고서입니다. 「보고서 고치기」를 누른 뒤 고쳐 주세요.'; end if;
  if v is null then delete from report_pastor_messages where report_id = p_report; return; end if;
  insert into report_pastor_messages (report_id, content, updated_by)
  values (p_report, v, private.current_profile_id())
  on conflict (report_id) do update
    set content = excluded.content, updated_by = excluded.updated_by, updated_at = now(),
        content_en = case when report_pastor_messages.content = excluded.content then report_pastor_messages.content_en end;
end $function$;

CREATE OR REPLACE FUNCTION public.review_update(p_review uuid, p_note text, p_level escalation_level)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v leadership_reviews;
begin
  select * into v from leadership_reviews where id = p_review for update;
  if not found or v.reviewer_id is distinct from private.current_profile_id() then
    raise exception '직접 확인하신 기록만 고칠 수 있습니다.';
  end if;
  update leadership_reviews
     set review_note = nullif(btrim(coalesce(p_note, '')), ''),
         escalation_level = coalesce(p_level, escalation_level),
         edited_at = now()
   where id = p_review;
  perform private.log_event(v.report_id, 'review_edited', jsonb_build_object('submission_no', v.submission_no));
end $function$;

CREATE OR REPLACE FUNCTION public.save_report(p_report uuid, p_data jsonb, p_version integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r weekly_reports;
begin
  select * into r from weekly_reports where id = p_report for update;
  if not found or not private.can_write_report(r.cell_id, r.week_start) then
    raise exception '이 보고서를 수정할 권한이 없습니다. 그 주 셀리더나 담당 교역자만 수정할 수 있습니다.';
  end if;
  if r.status = 'submitted' then
    raise exception '제출한 보고서는 수정할 수 없습니다. 수정이 필요하면 Leadership께 수정 요청을 부탁해 주세요.';
  end if;
  if r.version <> p_version then
    raise exception 'VERSION_CONFLICT: 다른 셀리더가 방금 저장했습니다. 최신 내용을 불러와 주세요.'
      using errcode = 'P0409';
  end if;

  update weekly_reports set
    meeting_held          = (p_data->>'meeting_held')::boolean,
    meeting_date          = nullif(p_data->>'meeting_date', '')::date,
    meeting_cancel_reason = nullif(p_data->>'meeting_cancel_reason', ''),
    meeting_time          = case when p_data ? 'meeting_time' then nullif(left(btrim(coalesce(p_data->>'meeting_time', '')), 20), '') else meeting_time end,
    meeting_place         = case when p_data ? 'meeting_place' then nullif(left(btrim(coalesce(p_data->>'meeting_place', '')), 80), '') else meeting_place end,
    grace_notes           = nullif(p_data->>'grace_notes', ''),
    grace_none            = coalesce((p_data->>'grace_none')::boolean, false),
    leader_message        = coalesce(nullif(p_data->>'leader_message', ''), 'none')::leader_message,
    leader_message_note   = case when coalesce(nullif(p_data->>'leader_message', ''), 'none') = 'none' then null
                                 else nullif(trim(coalesce(p_data->>'leader_message_note', '')), '') end,
    updated_by            = private.current_profile_id(),
    updated_at            = now(),
    version               = version + 1
  where id = p_report;

  if p_data ? 'attendance' then
    -- 셀원 관리에서 빠진 분(이 주 명단에 없는 분)의 출석은 막지 않고 빼고 저장
    delete from attendance where report_id = p_report;
    insert into attendance (report_id, member_id, status, absence_reason)
    select p_report, (a->>'member_id')::uuid,
           coalesce(nullif(a->>'status', ''), 'unknown')::attendance_status,
           nullif(a->>'absence_reason', '')
      from jsonb_array_elements(p_data->'attendance') a
     where private.member_valid_in_week((a->>'member_id')::uuid, r.cell_id, r.week_start);
  end if;

  if p_data ? 'care_notes' then
    -- 이 셀의 셀원이었던 분이면(그 사이 빠지거나 다른 셀로 옮겼어도) 적은 내용을 그대로 저장
    if exists (select 1 from jsonb_array_elements(p_data->'care_notes') c
               where not exists (select 1 from cell_members m where m.id = nullif(c->>'member_id', '')::uuid and m.cell_id = r.cell_id)) then
      raise exception '이 셀의 셀원이 아닌 분의 셀 케어 기록이 있습니다. 셀 케어 단계에서 셀원을 다시 골라 주세요.';
    end if;
    delete from care_notes where report_id = p_report;
    -- 관계 상대도 이 셀의 셀원이었던 분이면 그대로 (아니면 상대 이름만 남김)
    insert into care_notes (report_id, member_id, category, categories, content, prayer, leadership_attention_required,
                            related_member_id, related_name, relation_kind)
    select p_report, (s.c->>'member_id')::uuid, s.cats[1]::care_category, s.cats, coalesce(trim(s.c->>'content'), ''),
           nullif(trim(coalesce(s.c->>'prayer', '')), ''),
           coalesce((s.c->>'leadership_attention_required')::boolean, false),
           case when 'relationship' = any(s.cats) and s.rel_ok then nullif(s.c->>'related_member_id', '')::uuid end,
           case when 'relationship' = any(s.cats) and nullif(s.c->>'related_member_id', '') is null
                then nullif(left(trim(coalesce(s.c->>'related_name', '')), 60), '')
                when 'relationship' = any(s.cats) and not s.rel_ok
                then (select left(m.name, 60) from cell_members m where m.id = nullif(s.c->>'related_member_id', '')::uuid) end,
           case when 'relationship' = any(s.cats)
                 and (nullif(s.c->>'related_member_id', '') is not null or nullif(trim(coalesce(s.c->>'related_name', '')), '') is not null)
                then case when s.c->>'relation_kind' = 'one_way' then 'one_way' else 'mutual' end end
      from (select c, coalesce(nullif(array(select x from jsonb_array_elements_text(case when jsonb_typeof(c->'categories') = 'array' then c->'categories' else '[]'::jsonb end) with ordinality t(x, i)
                                             where x = any(enum_range(null::care_category)::text[]) order by i), '{}'),
                               case when c->>'category' = any(enum_range(null::care_category)::text[]) then array[c->>'category'] end) as cats,
                   (nullif(c->>'related_member_id', '') is null
                    or exists (select 1 from cell_members m where m.id = nullif(c->>'related_member_id', '')::uuid and m.cell_id = r.cell_id)) as rel_ok
              from jsonb_array_elements(p_data->'care_notes') c) s
     where s.cats is not null
       and (coalesce(trim(s.c->>'content'), '') <> '' or coalesce(trim(s.c->>'prayer'), '') <> '');
  end if;

  if p_data ? 'prayer_updates' then
    -- 셀원이 다른 셀로 옮기며 함께 옮겨간 기도제목 소식은 빼고 저장 (막지 않음)
    delete from prayer_updates where report_id = p_report;
    insert into prayer_updates (prayer_id, report_id, status, note)
    select (u->>'prayer_id')::uuid, p_report, (u->>'status')::prayer_status, nullif(u->>'note', '')
      from jsonb_array_elements(p_data->'prayer_updates') u
     where exists (select 1 from prayer_requests pr join weekly_reports src on src.id = pr.report_id
                    where pr.id = (u->>'prayer_id')::uuid and pr.cell_id = r.cell_id and src.week_start < r.week_start);
  end if;

  return r.version + 1;
end $function$;

CREATE OR REPLACE FUNCTION public.senior_comment_add(p_report uuid, p_target text, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r weekly_reports; v text := nullif(btrim(coalesce(p_content, '')), ''); v_id uuid;
begin
  if not private.is_senior() then raise exception '담임 목사님·사모님만 코멘트를 남길 수 있습니다.'; end if;
  if v is null then raise exception '코멘트를 적어 주세요.'; end if;
  if p_target not in ('report', 'pastor_msg') then raise exception 'target'; end if;
  select * into r from weekly_reports where id = p_report;
  if not found or r.submitted_at is null then raise exception '제출된 보고서에만 코멘트를 남길 수 있습니다.'; end if;
  if p_target = 'pastor_msg' and not exists (select 1 from report_pastor_messages m where m.report_id = p_report) then
    raise exception '이 보고서에는 목사님께 드리는 말씀이 없습니다.';
  end if;
  insert into senior_comments (report_id, target, author_id, content)
  values (p_report, p_target, private.current_profile_id(), v) returning id into v_id;
  return v_id;
end $function$;

commit;
