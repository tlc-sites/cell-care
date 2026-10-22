-- 셀 케어 전용. 운영 적용과 앱 배포는 별도 승인 후 DB부터 진행한다.
-- 1) 성도 동정 이슈 구분 여러 개(public.pastoral_notes.categories 추가, 기존 category는 첫 번째 값으로 유지)
-- 4) 주요 모임 시간은 담당 교역자·관리자·담임 목사님/사모님만 바꿈(public.cell_set_schedule 권한만 변경)
-- 7) 셀 이동 건(연락 필요 → 이동 가능 → 완료)과 이력(report.cellcare_member_moves)
--    실제 이동은 「셀 이동 적용」 때만, 기존 public.member_move와 같은 방식(옛 행 left_at, 새 셀에 새 행)이라 과거 보고서 소속은 그대로다.
-- 여러 번 실행해도 같은 결과가 되도록 쓴다.
begin;

-- ---------- 1) 성도 동정 이슈 구분 여러 개 ----------
alter table public.pastoral_notes add column if not exists categories text[];
update public.pastoral_notes set categories=array[category] where categories is null;

-- 기존 저장 함수를 그대로 부르고(권한·검사 동일), 고른 유형들을 함께 저장한다.
create or replace function report.cellcare_pastoral_note_save(p_id uuid,p_met_on date,p_person text,p_categories text[],p_content text,p_prayer text,
  p_needs_pastor boolean,p_visibility text default 'all',p_viewers uuid[] default '{}',p_method text default 'in_person',p_campus text default '분당')
returns uuid language plpgsql security definer set search_path='' as $$
declare cats text[]; v_id uuid;
begin
 select coalesce(array_agg(x.c order by x.o),'{}') into cats from (
   select u.c,min(u.o) o from unnest(coalesce(p_categories,'{}')) with ordinality u(c,o)
   where u.c = any(array['update','prayer','faith','health','family','work_school','relationship','long_absence','care_needed','other'])
   group by u.c) x;
 if cardinality(cats)=0 then cats:=array['update']; end if;
 v_id := public.pastoral_note_save(p_id,p_met_on,p_person,cats[1],p_content,p_prayer,p_needs_pastor,p_visibility,p_viewers,p_method,p_campus);
 update public.pastoral_notes set categories=cats where id=v_id;
 return v_id;
end $$;

-- 읽을 수 있는 동정의 유형들. 옛 화면이 category만 바꾼 경우(첫 값이 다름)에는 category를 따른다.
create or replace function report.cellcare_note_categories(p_ids uuid[]) returns table(id uuid,categories text[])
language sql stable security definer set search_path='' as $$
 select n.id, case when cardinality(n.categories)>0 and n.categories[1]=n.category then n.categories else array[n.category] end
 from public.pastoral_notes n where n.id=any(p_ids) and n.active and private.can_read_pastoral_note(n.id);
$$;

-- ---------- 4) 주요 모임 시간: 교역자가 정함 ----------
create or replace function public.cell_set_schedule(p_cell uuid, p_day text, p_time text, p_place text)
 returns void language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $function$
begin
  if not (private.is_cell_leadership(p_cell) or private.is_admin() or private.is_senior()) then
    raise exception '주요 모임 시간은 이 셀의 담당 교역자와 관리자만 바꿀 수 있습니다.';
  end if;
  update cells set
    meet_day   = case when p_day in ('월','화','수','목','금','토','일') then p_day end,
    meet_time  = nullif(left(btrim(coalesce(p_time, '')), 20), ''),
    meet_place = nullif(left(btrim(coalesce(p_place, '')), 80), '')
   where id = p_cell;
end $function$;

-- ---------- 7) 셀 이동 건과 이력 ----------
create table if not exists report.cellcare_member_moves (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null, member_name text not null,
 from_cell_id uuid not null, from_cell_name text not null, from_staff text,
 to_cell_id uuid not null, to_cell_name text not null, to_staff text,
 decided_on date not null, memo text check(memo is null or char_length(memo)<=1000),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 leader_contacted_at timestamptz, leader_contacted_by uuid,
 member_contacted_at timestamptz, member_contacted_by uuid,
 applied_at timestamptz, applied_on date, applied_by uuid, new_member_id uuid,
 canceled_at timestamptz, canceled_by uuid, cancel_reason text
);
-- 한 셀원에 진행 중인 이동 건은 하나만
create unique index if not exists cellcare_member_moves_open_idx on report.cellcare_member_moves(member_id) where applied_at is null and canceled_at is null;
alter table report.cellcare_member_moves enable row level security;
revoke all on report.cellcare_member_moves from public,anon,authenticated;

create or replace function report.cellcare_active_me() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=private.current_profile_id() and active);
$$;

-- 셀 담당 교역자 이름 (셀 데이터 기준 자동 연결)
create or replace function report.cellcare_cell_staff(p_cell uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when c.staff_shared then '교역자 공동'
   when c.review_mode::text='senior_direct' then '담임 목사님·담임 사모님'
   else (select string_agg(p.name, ', ' order by p.name) from public.leadership_assignments a join public.profiles p on p.id=a.leadership_user_id
         where a.cell_id=c.id and a.start_date<=private.app_today() and (a.end_date is null or a.end_date>=private.app_today())) end
 from public.cells c where c.id=p_cell;
$$;

-- 이동 건 알림: 두 셀의 지금 담당 교역자(본인 제외)
create or replace function report.cellcare_move_notify(p_move uuid,p_title text) returns void
language sql security definer set search_path='' as $$
 insert into report.cellcare_notification_items(profile_id,event_key,title,body,url)
 select distinct a.leadership_user_id,'move-'||m.id||'-'||left(md5(p_title),8),p_title,
   m.member_name||' · '||m.from_cell_name||' → '||m.to_cell_name,'./#section=leadership'
 from report.cellcare_member_moves m join public.leadership_assignments a on a.cell_id in (m.from_cell_id,m.to_cell_id)
 join public.profiles p on p.id=a.leadership_user_id and p.active
 where m.id=p_move and a.leadership_user_id<>private.current_profile_id()
   and a.start_date<=private.app_today() and (a.end_date is null or a.end_date>=private.app_today())
 on conflict(profile_id,event_key) do nothing;
$$;

-- 등록 화면용: 모든 활성 셀(담당 교역자 포함)과 내가 맡은 셀의 지금 셀원
create or replace function report.cellcare_move_options() returns jsonb
language sql stable security definer set search_path='' as $$
 select case when not report.cellcare_active_me() or not (private.has_role('leadership') or private.is_admin()) then null else jsonb_build_object(
  'cells',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'campus',coalesce(c.campus,'분당'),'staff',report.cellcare_cell_staff(c.id),
      'mine',private.is_cell_leadership(c.id) or private.is_admin()) order by c.name),'[]') from public.cells c where c.active),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'cell_id',m.cell_id,'on_hold',m.on_hold) order by m.name),'[]')
      from public.cell_members m join public.cells c on c.id=m.cell_id and c.active
      where m.active and m.deleted_at is null and m.left_at is null
        and (private.is_cell_leadership(m.cell_id) or private.is_admin())
        and not exists(select 1 from report.cellcare_member_moves x where x.member_id=m.id and x.applied_at is null and x.canceled_at is null))) end;
$$;

create or replace function report.cellcare_move_create(p_member uuid,p_to uuid,p_decided_on date,p_memo text) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.cell_members; f public.cells; t public.cells; v_id uuid; d date := coalesce(p_decided_on,private.app_today());
begin
 select * into m from public.cell_members where id=p_member and active and deleted_at is null and left_at is null;
 if not found then raise exception '이동할 셀원을 찾지 못했습니다.'; end if;
 select * into f from public.cells where id=m.cell_id;
 if not report.cellcare_active_me() or not (private.is_cell_leadership(m.cell_id) or private.is_admin()) then
   raise exception '지금 셀의 담당 교역자와 관리자만 셀 이동을 등록할 수 있습니다.' using errcode='42501';
 end if;
 select * into t from public.cells where id=p_to and active;
 if not found or t.id=m.cell_id then raise exception '이동할 셀을 다시 골라 주세요.'; end if;
 if d > private.app_today() or d < private.app_today()-365 then raise exception '이동 결정일을 다시 확인해 주세요.'; end if;
 if exists(select 1 from report.cellcare_member_moves x where x.member_id=m.id and x.applied_at is null and x.canceled_at is null) then
   raise exception '이 셀원은 이미 진행 중인 이동 건이 있습니다.';
 end if;
 insert into report.cellcare_member_moves(member_id,member_name,from_cell_id,from_cell_name,from_staff,to_cell_id,to_cell_name,to_staff,decided_on,memo,created_by)
 values(m.id,m.name,f.id,f.name,report.cellcare_cell_staff(f.id),t.id,t.name,report.cellcare_cell_staff(t.id),d,nullif(btrim(coalesce(p_memo,'')),''),private.current_profile_id())
 returning id into v_id;
 perform report.cellcare_move_notify(v_id,'셀 이동이 등록되었습니다');
 return v_id;
end $$;

create or replace function report.cellcare_move_list(p_history boolean default false)
returns table(id uuid,member_name text,from_cell_id uuid,from_cell_name text,from_staff text,to_cell_id uuid,to_cell_name text,to_staff text,
  decided_on date,memo text,created_by_name text,created_at timestamptz,leader_contacted_at timestamptz,leader_contacted_name text,
  member_contacted_at timestamptz,member_contacted_name text,applied_at timestamptz,applied_on date,applied_by_name text,
  canceled_at timestamptz,cancel_reason text,status text,can_contact boolean,can_apply boolean,can_cancel boolean)
language sql stable security definer set search_path='' as $$
 select m.id,m.member_name,m.from_cell_id,m.from_cell_name,m.from_staff,m.to_cell_id,m.to_cell_name,m.to_staff,m.decided_on,m.memo,
   pc.name,m.created_at,m.leader_contacted_at,pl.name,m.member_contacted_at,pm.name,m.applied_at,m.applied_on,pa.name,m.canceled_at,m.cancel_reason,
   case when m.canceled_at is not null then 'canceled' when m.applied_at is not null then 'done'
        when m.leader_contacted_at is not null and m.member_contacted_at is not null then 'ready' else 'contact' end,
   m.applied_at is null and m.canceled_at is null and (private.is_cell_leadership(m.from_cell_id) or private.is_admin()),
   m.applied_at is null and m.canceled_at is null and m.leader_contacted_at is not null and m.member_contacted_at is not null
     and (private.is_cell_leadership(m.from_cell_id) or private.is_cell_leadership(m.to_cell_id) or private.is_admin()),
   m.applied_at is null and m.canceled_at is null
     and (private.is_cell_leadership(m.from_cell_id) or private.is_admin() or m.created_by=private.current_profile_id())
 from report.cellcare_member_moves m
 left join public.profiles pc on pc.id=m.created_by left join public.profiles pl on pl.id=m.leader_contacted_by
 left join public.profiles pm on pm.id=m.member_contacted_by left join public.profiles pa on pa.id=m.applied_by
 where report.cellcare_active_me()
   and (private.is_admin() or private.is_senior() or m.created_by=private.current_profile_id()
        or private.is_cell_leadership(m.from_cell_id) or private.is_cell_leadership(m.to_cell_id))
   and (case when p_history then m.applied_at is not null or m.canceled_at is not null else m.applied_at is null and m.canceled_at is null end)
 order by coalesce(m.applied_at,m.canceled_at,m.created_at) desc;
$$;

-- 연락 완료 체크 (기존 셀 담당 교역자·관리자). p_kind: leader | member
create or replace function report.cellcare_move_contact(p_id uuid,p_kind text,p_done boolean) returns void
language plpgsql security definer set search_path='' as $$
declare m report.cellcare_member_moves; me uuid := private.current_profile_id();
begin
 select * into m from report.cellcare_member_moves where id=p_id and applied_at is null and canceled_at is null for update;
 if not found then raise exception '진행 중인 이동 건이 아닙니다.'; end if;
 if not report.cellcare_active_me() or not (private.is_cell_leadership(m.from_cell_id) or private.is_admin()) then
   raise exception '기존 셀의 담당 교역자와 관리자만 연락 완료를 표시할 수 있습니다.' using errcode='42501';
 end if;
 if p_kind='leader' then
   update report.cellcare_member_moves set leader_contacted_at=case when p_done then coalesce(leader_contacted_at,now()) end,
     leader_contacted_by=case when p_done then coalesce(leader_contacted_by,me) end where id=p_id;
 elsif p_kind='member' then
   update report.cellcare_member_moves set member_contacted_at=case when p_done then coalesce(member_contacted_at,now()) end,
     member_contacted_by=case when p_done then coalesce(member_contacted_by,me) end where id=p_id;
 else raise exception 'invalid contact kind'; end if;
end $$;

-- 셀 이동 적용: 이때 실제 소속이 바뀐다. 이동 방식은 public.member_move와 같다(이번 주부터 새 셀, 지난 기록 보존, 진행 중 기도제목 함께 이동).
create or replace function report.cellcare_move_apply(p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare mv report.cellcare_member_moves; m public.cell_members; t public.cells; v_week date := private.week_start_of(private.app_today()); v_id uuid;
begin
 select * into mv from report.cellcare_member_moves where id=p_id and applied_at is null and canceled_at is null for update;
 if not found then raise exception '진행 중인 이동 건이 아닙니다.'; end if;
 if not report.cellcare_active_me() or not (private.is_cell_leadership(mv.from_cell_id) or private.is_cell_leadership(mv.to_cell_id) or private.is_admin()) then
   raise exception '두 셀의 담당 교역자와 관리자만 셀 이동을 적용할 수 있습니다.' using errcode='42501';
 end if;
 if mv.leader_contacted_at is null or mv.member_contacted_at is null then
   raise exception '기존 셀리더와 셀원 연락을 모두 마친 뒤 적용할 수 있습니다.';
 end if;
 select * into m from public.cell_members where id=mv.member_id and active and deleted_at is null for update;
 if not found or m.cell_id<>mv.from_cell_id or m.left_at is not null then
   raise exception '셀원이 이미 기존 셀을 떠났습니다. 이동 건을 취소하고 다시 등록해 주세요.';
 end if;
 select * into t from public.cells where id=mv.to_cell_id and active;
 if not found then raise exception '이동할 셀이 닫혀 있습니다.'; end if;
 if exists (select 1 from public.cell_members x where x.cell_id=t.id and x.active and x.deleted_at is null
             and replace(x.name,' ','')=replace(m.name,' ','') and (x.left_at is null or x.left_at>=v_week)) then
   raise exception '옮길 셀에 같은 이름의 셀원이 이미 있습니다.';
 end if;
 -- 옛 셀: 이번 주부터 내려감 (이번 주에 들어온 분·방문자는 목록에서만 내림)
 if m.member_type::text='visitor' or (m.joined_at is not null and m.joined_at>=v_week) then
   update public.cell_members set active=false where id=m.id;
 else
   update public.cell_members set left_at=v_week-1 where id=m.id;
 end if;
 -- 새 셀: 이번 주부터
 insert into public.cell_members(cell_id,name,member_type,first_seen_week,joined_at,registered_at,registered_by,created_by,meets_separately)
 values(t.id,m.name,m.member_type,v_week,case when m.member_type::text='member' then v_week end,
        case when m.member_type::text='member' then now() end,case when m.member_type::text='member' then private.current_profile_id() end,
        private.current_profile_id(),coalesce(m.meets_separately,false))
 returning id into v_id;
 update public.prayer_requests set cell_id=t.id,member_id=v_id where member_id=m.id and status::text='ongoing';
 update report.cellcare_member_moves set applied_at=now(),applied_on=private.app_today(),applied_by=private.current_profile_id(),new_member_id=v_id,
   to_cell_name=t.name,to_staff=coalesce(report.cellcare_cell_staff(t.id),to_staff) where id=p_id;
 perform report.cellcare_move_notify(p_id,'셀 이동이 적용되었습니다');
 return v_id;
end $$;

create or replace function report.cellcare_move_cancel(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare m report.cellcare_member_moves;
begin
 select * into m from report.cellcare_member_moves where id=p_id and applied_at is null and canceled_at is null for update;
 if not found then raise exception '진행 중인 이동 건이 아닙니다.'; end if;
 if not report.cellcare_active_me() or not (private.is_cell_leadership(m.from_cell_id) or private.is_admin() or m.created_by=private.current_profile_id()) then
   raise exception '이 이동 건을 취소할 권한이 없습니다.' using errcode='42501';
 end if;
 update report.cellcare_member_moves set canceled_at=now(),canceled_by=private.current_profile_id(),cancel_reason=nullif(btrim(coalesce(p_reason,'')),'') where id=p_id;
end $$;

revoke all on function report.cellcare_active_me(),report.cellcare_cell_staff(uuid),report.cellcare_move_notify(uuid,text) from public,anon,authenticated;
revoke all on function report.cellcare_pastoral_note_save(uuid,date,text,text[],text,text,boolean,text,uuid[],text,text),report.cellcare_note_categories(uuid[]),
  report.cellcare_move_options(),report.cellcare_move_create(uuid,uuid,date,text),report.cellcare_move_list(boolean),
  report.cellcare_move_contact(uuid,text,boolean),report.cellcare_move_apply(uuid),report.cellcare_move_cancel(uuid,text) from public,anon;
grant execute on function report.cellcare_pastoral_note_save(uuid,date,text,text[],text,text,boolean,text,uuid[],text,text),report.cellcare_note_categories(uuid[]),
  report.cellcare_move_options(),report.cellcare_move_create(uuid,uuid,date,text),report.cellcare_move_list(boolean),
  report.cellcare_move_contact(uuid,text,boolean),report.cellcare_move_apply(uuid),report.cellcare_move_cancel(uuid,text) to authenticated;
commit;
