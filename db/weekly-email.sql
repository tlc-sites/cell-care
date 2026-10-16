-- Additive migration, based on public/private functions inspected on 2026-10-16.
-- Apply as the database owner. No recipients are enrolled and no existing RLS is changed.
begin;
create table public.weekly_email_settings (
  auth_user_id uuid primary key references auth.users(id),
  lang text not null check (lang in ('ko', 'en')),
  enabled boolean not null default false
);
create table public.weekly_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  week_start date not null check (extract(isodow from week_start) = 1),
  auth_user_id uuid not null references auth.users(id),
  state text not null check (state in ('preparing','sending','sent','failed','uncertain')),
  message_id text,
  updated_at timestamptz not null default now(),
  unique (week_start, auth_user_id)
);
alter table public.weekly_email_settings enable row level security;
alter table public.weekly_email_deliveries enable row level security;
revoke all on public.weekly_email_settings, public.weekly_email_deliveries from public, anon, authenticated;
-- Service-only functions below are the sole application entry points.

create function public.weekly_email_recipients()
returns table(auth_user_id uuid, email text, lang text)
language sql stable security definer set search_path = '' as $$
  select s.auth_user_id, u.email::text,
    case when exists(select 1 from public.user_roles ur where ur.user_id=p.id and ur.role='senior_pastor') then 'en' else s.lang end
  from public.weekly_email_settings s
  join auth.users u on u.id = s.auth_user_id and u.email_confirmed_at is not null
  join public.profiles p on p.auth_user_id = u.id and p.active
  where s.enabled and exists (
    select 1 from public.user_roles r where r.user_id = p.id and r.role in ('senior_pastor','samonim')
  ) order by s.auth_user_id
$$;

create function public.weekly_email_claim(p_week date, p_auth_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare delivery uuid;
begin
  if not exists (select 1 from public.weekly_email_recipients() r where r.auth_user_id=p_auth_user) then
    raise exception 'Recipient is not eligible';
  end if;
  insert into public.weekly_email_deliveries(week_start,auth_user_id,state)
    values(p_week,p_auth_user,'preparing')
    on conflict(week_start,auth_user_id) do update
    set id=gen_random_uuid(), state='preparing', message_id=null, updated_at=now()
    where weekly_email_deliveries.state='failed'
       or (weekly_email_deliveries.state='preparing' and weekly_email_deliveries.updated_at < now()-interval '15 minutes')
    returning id into delivery;
  return delivery;
end $$;

create function public.weekly_email_mark(p_id uuid, p_state text, p_message_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.weekly_email_deliveries set state=p_state,
    message_id=coalesce(p_message_id,message_id), updated_at=now()
  where id=p_id and (
    (state='preparing' and p_state in ('sending','failed')) or
    (state='sending' and p_state in ('sent','uncertain'))
  );
  if not found then raise exception 'Invalid delivery transition'; end if;
end $$;

create function public.weekly_email_set_language(p_lang text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_lang not in ('ko','en') or not private.is_senior() then raise exception 'Not allowed'; end if;
  update public.weekly_email_settings set lang=p_lang where auth_user_id=auth.uid() and private.has_role('samonim');
end $$;

create function public.weekly_email_snapshot(p_week date,p_auth_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  old_claims text := current_setting('request.jwt.claims',true);
  old_sub text := current_setting('request.jwt.claim.sub',true);
  result jsonb; pid uuid; statuses jsonb; pastoral_statuses jsonb;
  pastoral_reports jsonb; reports jsonb; messages jsonb; notes jsonb;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then raise exception 'Monday required'; end if;
  if not exists (select 1 from public.weekly_email_recipients() r where r.auth_user_id=p_auth_user) then
    raise exception 'Recipient is not eligible';
  end if;
  -- Service-only wrapper supplies recipient context to the EXISTING permission helpers.
  -- No arbitrary caller can choose another user's identity (EXECUTE revoked below).
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_auth_user,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',p_auth_user::text,true);
  pid := private.current_profile_id();
  if pid is null or not private.is_senior() then raise exception 'Senior role required'; end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.cell_name),'[]') into statuses from public.get_week_status(p_week) s;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.author_name),'[]') into pastoral_statuses from public.lr_overview(p_week) s;
  select coalesce(jsonb_agg(public.lr_read((s->>'report_id')::uuid)),'[]') into pastoral_reports
    from jsonb_array_elements(pastoral_statuses) s where s->>'status'='submitted';
  select coalesce(jsonb_agg(to_jsonb(m)),'[]') into messages from public.pastor_msgs_week(p_week) m
    join public.weekly_reports r on r.id=m.report_id and r.status='submitted'
    where private.can_read_report(r.id);
  -- No 200-row note-list limit: scope by week first and retain existing visibility checks.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',n.id,'met_on',n.met_on,'person_name',n.person_name,'category',n.category,
    'content',n.content,'prayer',n.prayer,'needs_pastor',n.needs_pastor,
    'visit_method',n.visit_method,'campus',n.campus,
    'i_acked',exists(select 1 from public.pastoral_note_acks a where a.note_id=n.id and a.profile_id=pid)
  ) order by n.met_on,n.created_at),'[]') into notes from public.pastoral_notes n
    where n.met_on between p_week and p_week+6 and private.can_read_pastoral_note(n.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'cell_name',s->>'cell_name','group_name',s->>'responsible_leadership_name','escalation_level',s->>'escalation_level',
    'meeting_date',r.meeting_date,'meeting_cancel_reason',r.meeting_cancel_reason,
    'grace_notes',r.grace_notes,'leader_message',r.leader_message,'leader_message_note',r.leader_message_note,
    'present',coalesce((s->>'members_present')::int,0)+coalesce((s->>'visitors_present')::int,0),
    'absent',coalesce((s->>'members_absent')::int,0),
    'care',(select coalesce(jsonb_agg(to_jsonb(cn)||jsonb_build_object('person_name',cm.name,
        'related_name',coalesce(nullif(cn.related_name,''),rm.name)) order by cn.created_at),'[]')
      from public.care_notes cn left join public.cell_members cm on cm.id=cn.member_id
      left join public.cell_members rm on rm.id=cn.related_member_id where cn.report_id=r.id),
    'prayers',(select coalesce(jsonb_agg(to_jsonb(pr)),'[]') from public.get_open_prayers(r.id) pr),
    'new_prayers',(select coalesce(jsonb_agg(jsonb_build_object('content',pr.content,'person_name',cm.name)),'[]')
      from public.prayer_requests pr left join public.cell_members cm on cm.id=pr.member_id where pr.report_id=r.id),
    'reviews',(select coalesce(jsonb_agg(to_jsonb(v) order by v.submission_no),'[]') from public.leadership_reviews v
      where v.report_id=r.id and private.can_oversee_report(r.id))
  ) order by s->>'responsible_leadership_name',s->>'cell_name'),'[]') into reports
  from jsonb_array_elements(statuses) s join public.weekly_reports r on r.id=(s->>'report_id')::uuid
  where r.status='submitted' and private.can_read_report(r.id);
  result := jsonb_build_object('week',p_week,'generated_at',now(),'auth_user_id',p_auth_user,'status',statuses,
    'pastoral_status',pastoral_statuses,'pastoral_reports',pastoral_reports,'reports',reports,'messages',messages,'notes',notes);
  perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  return result;
end $$;

revoke all on function public.weekly_email_recipients() from public, anon, authenticated;
revoke all on function public.weekly_email_claim(date,uuid) from public, anon, authenticated;
revoke all on function public.weekly_email_mark(uuid,text,text) from public, anon, authenticated;
revoke all on function public.weekly_email_snapshot(date,uuid) from public, anon, authenticated;
revoke all on function public.weekly_email_set_language(text) from public, anon;
grant execute on function public.weekly_email_recipients(), public.weekly_email_claim(date,uuid),
  public.weekly_email_mark(uuid,text,text), public.weekly_email_snapshot(date,uuid) to service_role;
grant execute on function public.weekly_email_set_language(text) to authenticated;
commit;
