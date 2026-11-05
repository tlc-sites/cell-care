-- 성도 동정 코멘트를 교역자도 남기기 (2026-11-05 요청)
--   운영 public.note_comment_add(2026-11-05 운영에서 읽음)는 첫 줄에서 담임 목사님·사모님만 허용했다.
--   허용 대상만 「담임 목사님·사모님 또는 교역자(leadership)」로 넓히고, 나머지는 운영 본문과 같다.
--   그 동정을 볼 수 있는 분만 남길 수 있다는 조건(can_read_pastoral_note)은 그대로다.
--   지우기·목록·알림 함수(note_comment_delete·note_comments_for·note_comment_for_send·note_comment_push_targets)는
--   쓴 분 기준이라 바꾸지 않는다.
-- 여러 번 실행해도 안전하다. 앱보다 먼저 적용한다.
begin;
create or replace function public.note_comment_add(p_note uuid, p_content text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v text := nullif(left(btrim(coalesce(p_content, '')), 3000), ''); v_id uuid;
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
revoke all on function public.note_comment_add(uuid,text) from public,anon;
grant execute on function public.note_comment_add(uuid,text) to authenticated;
commit;
