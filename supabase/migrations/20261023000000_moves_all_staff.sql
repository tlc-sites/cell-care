-- 셀 이동: 활성 교역자(leadership)와 관리자는 모든 셀·모든 셀원을 보고 고를 수 있고,
-- 등록 · 목록 · 연락 완료 체크 · 적용 · 취소를 셀 담당과 관계없이 할 수 있다(사용자 결정 2026-10-23).
-- 담임 목사님·사모님은 지금처럼 목록만 본다. 알림은 지금처럼 두 셀의 담당 교역자에게 간다.
-- 20261022010000_note_categories_moves_schedule.sql 다음에 적용. report 스키마 함수만 바꾸며 여러 번 실행해도 안전하다.
begin;

create or replace function report.cellcare_move_staff() returns boolean
language sql stable security definer set search_path='' as $$
 select report.cellcare_active_me() and (private.has_role('leadership') or private.is_admin());
$$;

-- 등록 화면용: 모든 활성 셀과 그 셀의 지금 셀원 (mine: 내가 맡은 셀을 위에 보여 주기 위함)
create or replace function report.cellcare_move_options() returns jsonb
language sql stable security definer set search_path='' as $$
 select case when not report.cellcare_move_staff() then null else jsonb_build_object(
  'cells',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'campus',coalesce(c.campus,'분당'),'staff',report.cellcare_cell_staff(c.id),
      'mine',private.is_cell_leadership(c.id)) order by c.name),'[]') from public.cells c where c.active),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'cell_id',m.cell_id,'on_hold',m.on_hold) order by m.name),'[]')
      from public.cell_members m join public.cells c on c.id=m.cell_id and c.active
      where m.active and m.deleted_at is null and m.left_at is null
        and not exists(select 1 from report.cellcare_member_moves x where x.member_id=m.id and x.applied_at is null and x.canceled_at is null))) end;
$$;

create or replace function report.cellcare_move_create(p_member uuid,p_to uuid,p_decided_on date,p_memo text) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.cell_members; f public.cells; t public.cells; v_id uuid; d date := coalesce(p_decided_on,private.app_today());
begin
 if not report.cellcare_move_staff() then
   raise exception '교역자와 관리자만 셀 이동을 등록할 수 있습니다.' using errcode='42501';
 end if;
 select * into m from public.cell_members where id=p_member and active and deleted_at is null and left_at is null;
 if not found then raise exception '이동할 셀원을 찾지 못했습니다.'; end if;
 select * into f from public.cells where id=m.cell_id;
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
   m.applied_at is null and m.canceled_at is null and s.staff,
   m.applied_at is null and m.canceled_at is null and m.leader_contacted_at is not null and m.member_contacted_at is not null and s.staff,
   m.applied_at is null and m.canceled_at is null and (s.staff or m.created_by=private.current_profile_id())
 from report.cellcare_member_moves m cross join (select report.cellcare_move_staff() as staff) s
 left join public.profiles pc on pc.id=m.created_by left join public.profiles pl on pl.id=m.leader_contacted_by
 left join public.profiles pm on pm.id=m.member_contacted_by left join public.profiles pa on pa.id=m.applied_by
 where report.cellcare_active_me()
   and (s.staff or private.is_senior() or m.created_by=private.current_profile_id())
   and (case when p_history then m.applied_at is not null or m.canceled_at is not null else m.applied_at is null and m.canceled_at is null end)
 order by coalesce(m.applied_at,m.canceled_at,m.created_at) desc;
$$;

-- 연락 완료 체크. p_kind: leader | member
create or replace function report.cellcare_move_contact(p_id uuid,p_kind text,p_done boolean) returns void
language plpgsql security definer set search_path='' as $$
declare m report.cellcare_member_moves; me uuid := private.current_profile_id();
begin
 if not report.cellcare_move_staff() then
   raise exception '교역자와 관리자만 연락 완료를 표시할 수 있습니다.' using errcode='42501';
 end if;
 select * into m from report.cellcare_member_moves where id=p_id and applied_at is null and canceled_at is null for update;
 if not found then raise exception '진행 중인 이동 건이 아닙니다.'; end if;
 if p_kind='leader' then
   update report.cellcare_member_moves set leader_contacted_at=case when p_done then coalesce(leader_contacted_at,now()) end,
     leader_contacted_by=case when p_done then coalesce(leader_contacted_by,me) end where id=p_id;
 elsif p_kind='member' then
   update report.cellcare_member_moves set member_contacted_at=case when p_done then coalesce(member_contacted_at,now()) end,
     member_contacted_by=case when p_done then coalesce(member_contacted_by,me) end where id=p_id;
 else raise exception 'invalid contact kind'; end if;
end $$;

-- 셀 이동 적용: 권한 검사만 넓히고 이동 방식은 20261022010000과 같다
create or replace function report.cellcare_move_apply(p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare mv report.cellcare_member_moves; m public.cell_members; t public.cells; v_week date := private.week_start_of(private.app_today()); v_id uuid;
begin
 if not report.cellcare_move_staff() then
   raise exception '교역자와 관리자만 셀 이동을 적용할 수 있습니다.' using errcode='42501';
 end if;
 select * into mv from report.cellcare_member_moves where id=p_id and applied_at is null and canceled_at is null for update;
 if not found then raise exception '진행 중인 이동 건이 아닙니다.'; end if;
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
 if not (report.cellcare_move_staff() or (report.cellcare_active_me() and m.created_by=private.current_profile_id())) then
   raise exception '이 이동 건을 취소할 권한이 없습니다.' using errcode='42501';
 end if;
 update report.cellcare_member_moves set canceled_at=now(),canceled_by=private.current_profile_id(),cancel_reason=nullif(btrim(coalesce(p_reason,'')),'') where id=p_id;
end $$;

revoke all on function report.cellcare_move_staff() from public,anon,authenticated;
revoke all on function report.cellcare_move_options(),report.cellcare_move_create(uuid,uuid,date,text),report.cellcare_move_list(boolean),
  report.cellcare_move_contact(uuid,text,boolean),report.cellcare_move_apply(uuid),report.cellcare_move_cancel(uuid,text) from public,anon;
grant execute on function report.cellcare_move_options(),report.cellcare_move_create(uuid,uuid,date,text),report.cellcare_move_list(boolean),
  report.cellcare_move_contact(uuid,text,boolean),report.cellcare_move_apply(uuid),report.cellcare_move_cancel(uuid,text) to authenticated;
commit;
