-- 셀모임 2주 이상 연속 미진행 → 담임 목사님·담임 사모님 「목회적 케어 보고」 (2026-10-26)
-- 판정은 AI 없이 보고서의 meeting_held와 주차(week_start, 월요일)로만 한다.
--   실제 미모임 : 제출된 보고서가 있고 meeting_held=false
--   보고 미제출 : 마감이 지난 주에 제출된 보고서가 없음 → 경고로 세지 않고 따로 보여 준다
--   2주 연속 미모임 PASTORAL_ATTENTION, 3주 이상 URGENT_PASTORAL_ATTENTION
-- 셀마다 열린 경고(RESOLVED가 아닌 것)는 하나만 둔다. 다시 모이면 RESOLVED, 그 뒤 다시 2주가 되면 새 경고.
-- 세 가지를 따로 기록한다: 메일 발송(email_logs) · 두 분의 시스템 내 확인(alert_reads) · 셀 문제 해결(status/resolved_at)
-- 보고서 열람(cellcare_report_reads)이나 알림 읽음으로는 확인·해결되지 않는다.
-- 이 파일은 20261023010000_senior_acks.sql(cellcare_senior_role)이 먼저 적용되어 있어야 한다.
-- 기존 업무 테이블(public)은 바꾸지 않는다. 여러 번 실행해도 안전하다. 앱보다 먼저 적용한다.
begin;
create schema if not exists report;
grant usage on schema report to authenticated,service_role;

create table if not exists report.cellcare_pastoral_alerts (
 id uuid primary key default gen_random_uuid(),
 cell_id uuid not null references public.cells(id),
 cell_name text,                       -- 그때의 이름(화면은 지금 셀 이름을 먼저 씀)
 cell_leader_id uuid, cell_leader_name text,
 leadership_id uuid, leadership_name text,   -- 담당 교역자(분파셀리더)
 alert_type text not null check(alert_type in ('PASTORAL_ATTENTION','URGENT_PASTORAL_ATTENTION')),
 status text not null default 'OPEN' check(status in ('OPEN','ACKNOWLEDGED','RESOLVED')),
 consecutive_weeks integer not null,
 gap_weeks integer not null default 0,     -- 연속 기간 중 보고서가 없어 세지 않은 주
 first_missed_week date, last_missed_week date, last_meeting_date date,
 latest_report_id uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 level_changed_at timestamptz not null default now(),  -- 처음 생기거나 긴급으로 올라간 때
 acknowledged_at timestamptz,
 resolved_at timestamptz, resolved_reason text,
 initial_email_sent_at timestamptz,    -- 2주째 메일이 한 분에게라도 간 때
 urgent_email_sent_at timestamptz      -- 3주째(긴급) 메일이 한 분에게라도 간 때
);
create unique index if not exists cellcare_pastoral_alerts_one_open on report.cellcare_pastoral_alerts(cell_id) where status<>'RESOLVED';
alter table report.cellcare_pastoral_alerts add column if not exists gap_weeks integer not null default 0;
alter table report.cellcare_pastoral_alerts enable row level security;
revoke all on report.cellcare_pastoral_alerts from public,anon,authenticated;

-- 두 분이 각자, 단계마다 남김(2주째 확인과 긴급 확인을 따로)
create table if not exists report.cellcare_pastoral_alert_reads (
 alert_id uuid not null references report.cellcare_pastoral_alerts(id),
 profile_id uuid not null references public.profiles(id),
 role text not null check(role in ('senior_pastor','samonim')),
 alert_type text not null check(alert_type in ('PASTORAL_ATTENTION','URGENT_PASTORAL_ATTENTION')),
 read_at timestamptz not null default now(),
 primary key(alert_id,profile_id,alert_type)
);
alter table report.cellcare_pastoral_alert_reads enable row level security;
revoke all on report.cellcare_pastoral_alert_reads from public,anon,authenticated;

-- 메일 기록: 같은 경고·같은 단계·같은 받는 분은 한 줄(중복 발송 방지). 실패는 3번까지 다시 시도
create table if not exists report.cellcare_pastoral_alert_email_logs (
 id uuid primary key default gen_random_uuid(),
 alert_id uuid not null references report.cellcare_pastoral_alerts(id),
 alert_level text not null,
 recipient text not null,
 status text not null check(status in ('PENDING','SENT','FAILED')),
 attempts integer not null default 1,
 error_message text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 sent_at timestamptz,
 unique(alert_id,alert_level,recipient)
);
alter table report.cellcare_pastoral_alert_email_logs enable row level security;
revoke all on report.cellcare_pastoral_alert_email_logs from public,anon,authenticated;

-- 그 주 보고 마감(한국 시간): 금 12:00, 토·일 모임 셀은 다음 주 금 12:00. 보고 미제출 표시에만 쓴다.
create or replace function report.cellcare_week_deadline(p_week date,p_meet_day text) returns timestamptz
language sql immutable set search_path='' as $$
 select ((p_week + 4 + case when p_meet_day in ('토','일') then 7 else 0 end)::timestamp + time '12:00') at time zone 'Asia/Seoul';
$$;

-- 연속 미모임 계산 (getConsecutiveMissedMeetings). AI 없이 DB 자료만 쓴다.
--   missed_weeks : 제출된 보고서를 최근 주부터 거슬러 보며, 모임을 한 보고서가 나오기 전까지 meeting_held=false인 주 수
--                  보고서가 없는 주는 미모임으로도 모임으로도 세지 않는다(gap_weeks로 따로 알려 줌)
--   missing_weeks: 마감이 지난 가장 최근 주부터 거슬러 올라가며, 제출된 보고서가 없는 주 수(셀이 생긴 주 이전은 세지 않음)
-- 「제출된 보고서」= 한 번이라도 제출된 보고서(submitted_at 있음). 고치는 중인 보고서도 미제출로 보지 않는다.
create or replace function report.cellcare_consecutive_missed_meetings(p_cell uuid,p_now timestamptz default now())
returns table(missed_weeks integer,first_missed_week date,last_missed_week date,gap_weeks integer,latest_report_id uuid,latest_week date,latest_held boolean,
 last_meeting_date date,missing_weeks integer,missing_since date)
language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare c record; r record; w date; i integer;
begin
 select x.id,x.meet_day,x.created_at into c from public.cells x where x.id=p_cell;
 if c.id is null then return; end if;
 missed_weeks := 0; missing_weeks := 0; gap_weeks := 0;
 for r in select distinct on (x.week_start) x.id,x.week_start,x.meeting_held from public.weekly_reports x
   where x.cell_id=p_cell and x.submitted_at is not null order by x.week_start desc,x.submitted_at desc limit 104 loop
   if latest_report_id is null then latest_report_id := r.id; latest_week := r.week_start; latest_held := r.meeting_held; end if;
   exit when r.meeting_held is not false;
   missed_weeks := missed_weeks+1; first_missed_week := r.week_start; last_missed_week := coalesce(last_missed_week,r.week_start);
 end loop;
 if missed_weeks>0 then gap_weeks := (last_missed_week-first_missed_week)/7+1-missed_weeks; end if;
 select max(coalesce(x.meeting_date,x.week_start)) into last_meeting_date from public.weekly_reports x
 where x.cell_id=p_cell and x.submitted_at is not null and x.meeting_held is true;
 w := date_trunc('week',(p_now at time zone 'Asia/Seoul'))::date;
 while report.cellcare_week_deadline(w,c.meet_day)>p_now loop w := w-7; end loop;
 for i in 1..104 loop
   exit when c.created_at is not null and w < date_trunc('week',(c.created_at at time zone 'Asia/Seoul'))::date;
   exit when exists(select 1 from public.weekly_reports x where x.cell_id=p_cell and x.week_start=w and x.submitted_at is not null);
   missing_weeks := missing_weeks+1; missing_since := w; w := w-7;
 end loop;
 return next;
end $$;

-- 지금 셀리더(대표 먼저)·담당 교역자 이름
create or replace function report.cellcare_cell_people(p_cell uuid,p_day date default (now() at time zone 'Asia/Seoul')::date)
returns table(leader_id uuid,leader_names text,leadership_id uuid,leadership_names text)
language sql stable security definer set search_path='' as $$
 select (select l.user_id from public.cell_leaders l where l.cell_id=p_cell and l.start_date<=p_day and (l.end_date is null or l.end_date>=p_day) order by l.is_primary desc nulls last,l.start_date limit 1),
  (select string_agg(p.name,', ' order by l.is_primary desc nulls last,p.name) from public.cell_leaders l join public.profiles p on p.id=l.user_id where l.cell_id=p_cell and l.start_date<=p_day and (l.end_date is null or l.end_date>=p_day)),
  (select a.leadership_user_id from public.leadership_assignments a where a.cell_id=p_cell and a.start_date<=p_day and (a.end_date is null or a.end_date>=p_day) order by a.start_date limit 1),
  (select string_agg(p.name,', ' order by p.name) from public.leadership_assignments a join public.profiles p on p.id=a.leadership_user_id where a.cell_id=p_cell and a.start_date<=p_day and (a.end_date is null or a.end_date>=p_day));
$$;

-- 판정 실행(서버 Cron 전용). p_dry=true면 아무것도 바꾸지 않고 할 일만 돌려준다.
--   생성: 열린 경고가 없고 2주 이상 → 새 경고
--   상향: 2주 경고가 3주 이상 → 같은 경고를 긴급으로, 다시 「확인 전」(OPEN)
--   갱신: 주 수·마지막 모임 등만 바꿈(4주, 5주…). 단계는 내리지 않는다
--   해결: 최근 보고서에서 모임을 함(MEETING_HELD) / 연속이 2주 미만으로 줄어듦(STREAK_BROKEN) / 셀이 닫힘(CELL_CLOSED)
--   최근 주가 미제출이면 경고를 그대로 둔다(미제출은 해결이 아님)
create or replace function report.cellcare_pastoral_evaluate(p_dry boolean default false,p_now timestamptz default now())
returns table(cell_id uuid,cell_name text,missed_weeks integer,missing_weeks integer,action text,alert_id uuid,alert_type text)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare c record; s record; a report.cellcare_pastoral_alerts; pp record; lvl text;
begin
 if not p_dry then perform pg_advisory_xact_lock(hashtext('report.cellcare_pastoral_evaluate')); end if;
 -- 닫힌 셀의 열린 경고
 for a in select x.* from report.cellcare_pastoral_alerts x join public.cells y on y.id=x.cell_id where x.status<>'RESOLVED' and y.active is not true loop
   if not p_dry then update report.cellcare_pastoral_alerts set status='RESOLVED',resolved_at=p_now,resolved_reason='CELL_CLOSED',updated_at=p_now where id=a.id; end if;
   cell_id:=a.cell_id; cell_name:=a.cell_name; missed_weeks:=a.consecutive_weeks; missing_weeks:=null; action:='resolved'; alert_id:=a.id; alert_type:=a.alert_type; return next;
 end loop;
 for c in select y.id,y.name from public.cells y where y.active is true order by y.name loop
   select * into s from report.cellcare_consecutive_missed_meetings(c.id,p_now);
   select x.* into a from report.cellcare_pastoral_alerts x where x.cell_id=c.id and x.status<>'RESOLVED' for update;
   cell_id:=c.id; cell_name:=c.name; missed_weeks:=coalesce(s.missed_weeks,0); missing_weeks:=s.missing_weeks; alert_id:=a.id; alert_type:=a.alert_type; action:='none';
   lvl := case when missed_weeks>=3 then 'URGENT_PASTORAL_ATTENTION' when missed_weeks>=2 then 'PASTORAL_ATTENTION' end;
   if lvl is not null then
     select * into pp from report.cellcare_cell_people(c.id,(p_now at time zone 'Asia/Seoul')::date);
     if a.id is null then
       action:='created'; alert_type:=lvl;
       if not p_dry then
         insert into report.cellcare_pastoral_alerts(cell_id,cell_name,cell_leader_id,cell_leader_name,leadership_id,leadership_name,alert_type,consecutive_weeks,
           gap_weeks,first_missed_week,last_missed_week,last_meeting_date,latest_report_id,created_at,updated_at,level_changed_at)
         values(c.id,c.name,pp.leader_id,pp.leader_names,pp.leadership_id,pp.leadership_names,lvl,missed_weeks,coalesce(s.gap_weeks,0),
           s.first_missed_week,s.last_missed_week,s.last_meeting_date,s.latest_report_id,p_now,p_now,p_now) returning id into alert_id;
       end if;
     else
       if a.alert_type='PASTORAL_ATTENTION' and lvl='URGENT_PASTORAL_ATTENTION' then action:='escalated'; alert_type:=lvl;
       elsif a.consecutive_weeks is distinct from missed_weeks or a.gap_weeks is distinct from coalesce(s.gap_weeks,0) or a.latest_report_id is distinct from s.latest_report_id
          or a.last_meeting_date is distinct from s.last_meeting_date or a.cell_name is distinct from c.name then action:='updated';
       end if;
       if not p_dry and action<>'none' then
         update report.cellcare_pastoral_alerts x set
           alert_type=case when action='escalated' then lvl else x.alert_type end,
           status=case when action='escalated' then 'OPEN' else x.status end,
           level_changed_at=case when action='escalated' then p_now else x.level_changed_at end,
           consecutive_weeks=missed_weeks,gap_weeks=coalesce(s.gap_weeks,0),first_missed_week=s.first_missed_week,last_missed_week=s.last_missed_week,
           last_meeting_date=s.last_meeting_date,latest_report_id=s.latest_report_id,cell_name=c.name,
           cell_leader_id=coalesce(pp.leader_id,x.cell_leader_id),cell_leader_name=coalesce(pp.leader_names,x.cell_leader_name),
           leadership_id=coalesce(pp.leadership_id,x.leadership_id),leadership_name=coalesce(pp.leadership_names,x.leadership_name),updated_at=p_now
         where x.id=a.id;
       end if;
     end if;
   elsif a.id is not null and (s.latest_held is true or missed_weeks<2) and s.latest_report_id is not null then
     action:='resolved';
     if not p_dry then
       update report.cellcare_pastoral_alerts set status='RESOLVED',resolved_at=p_now,updated_at=p_now,
         resolved_reason=case when s.latest_held is true then 'MEETING_HELD' else 'STREAK_BROKEN' end,latest_report_id=s.latest_report_id,
         last_meeting_date=s.last_meeting_date where id=a.id;
     end if;
   end if;
   if action<>'none' or missed_weeks>=2 then return next; end if;
 end loop;
end $$;

-- 보낼 메일(서버 Cron 전용): 단계마다 한 번. 기본 정책은 2주째(최초)와 3주째(긴급 상향)만.
-- 단계가 정해진 지 14일이 지난 것은 보내지 않는다(메일 설정을 나중에 켰을 때 옛 경고가 한꺼번에 가지 않게).
create or replace function report.cellcare_pastoral_email_due(p_now timestamptz default now())
returns table(alert_id uuid,alert_level text,cell_id uuid,cell_name text,cell_leader_name text,leadership_name text,consecutive_weeks integer,gap_weeks integer,
 last_meeting_date date,latest_week date,latest_report_id uuid,first_missed_week date)
language sql stable security definer set search_path='' as $$
 select a.id,a.alert_type,a.cell_id,coalesce(nullif(btrim(c.name),''),a.cell_name,'셀 정보 없음'),a.cell_leader_name,a.leadership_name,a.consecutive_weeks,a.gap_weeks,
  a.last_meeting_date,a.last_missed_week,a.latest_report_id,a.first_missed_week
 from report.cellcare_pastoral_alerts a left join public.cells c on c.id=a.cell_id
 where a.status<>'RESOLVED' and a.level_changed_at>p_now-interval '14 days'
 and ((a.alert_type='PASTORAL_ATTENTION' and a.initial_email_sent_at is null) or (a.alert_type='URGENT_PASTORAL_ATTENTION' and a.urgent_email_sent_at is null)
   or exists(select 1 from report.cellcare_pastoral_alert_email_logs l where l.alert_id=a.id and l.alert_level=a.alert_type and l.status='FAILED' and l.attempts<3))
 order by a.created_at;
$$;

-- 보내기 직전에 받는 분마다 자리를 잡는다. 돌려준 주소에만 보낸다(이미 보냈거나 다른 실행이 보내는 중이면 빠짐)
create or replace function report.cellcare_pastoral_email_claim(p_alert uuid,p_level text,p_recipients text[])
returns table(recipient text)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
begin
 if not exists(select 1 from report.cellcare_pastoral_alerts a where a.id=p_alert and a.alert_type=p_level and a.status<>'RESOLVED') then return; end if;
 return query
 insert into report.cellcare_pastoral_alert_email_logs as l(alert_id,alert_level,recipient,status)
 select distinct p_alert,p_level,lower(btrim(x)),'PENDING' from unnest(p_recipients) x where btrim(coalesce(x,''))<>''
 on conflict(alert_id,alert_level,recipient) do update set status='PENDING',attempts=l.attempts+1,error_message=null,updated_at=now()
   where (l.status='FAILED' and l.attempts<3) or (l.status='PENDING' and l.updated_at<now()-interval '30 minutes')
 returning l.recipient;
end $$;

-- 보낸 결과 기록. 한 분에게라도 가면 그 단계의 「메일 보냄」 시간을 남긴다(확인·해결과는 별개)
create or replace function report.cellcare_pastoral_email_result(p_alert uuid,p_level text,p_recipient text,p_ok boolean,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 update report.cellcare_pastoral_alert_email_logs set status=case when p_ok then 'SENT' else 'FAILED' end,
   sent_at=case when p_ok then now() end,error_message=case when p_ok then null else left(coalesce(p_error,'unknown'),500) end,updated_at=now()
 where alert_id=p_alert and alert_level=p_level and recipient=lower(btrim(p_recipient));
 if p_ok then
   update report.cellcare_pastoral_alerts set
     initial_email_sent_at=case when p_level='PASTORAL_ATTENTION' then coalesce(initial_email_sent_at,now()) else initial_email_sent_at end,
     urgent_email_sent_at=case when p_level='URGENT_PASTORAL_ATTENTION' then coalesce(urgent_email_sent_at,now()) else urgent_email_sent_at end
   where id=p_alert;
 end if;
end $$;

-- 담임 목사님·담임 사모님이 시스템에서 직접 확인(각자, 단계마다). 셀 문제 해결과는 별개라 경고는 그대로 남는다
create or replace function report.cellcare_pastoral_alert_ack(p_alert uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare v_role text := report.cellcare_senior_role(); a report.cellcare_pastoral_alerts; v_at timestamptz;
begin
 if v_role is null then raise exception '담임 목사님·담임 사모님만 확인 표시를 할 수 있습니다.' using errcode='42501'; end if;
 select * into a from report.cellcare_pastoral_alerts where id=p_alert for update;
 if a.id is null then raise exception '확인 표시를 할 수 없는 항목입니다.' using errcode='42501'; end if;
 insert into report.cellcare_pastoral_alert_reads(alert_id,profile_id,role,alert_type) values(a.id,private.current_profile_id(),v_role,a.alert_type)
 on conflict(alert_id,profile_id,alert_type) do nothing;
 select r.read_at into v_at from report.cellcare_pastoral_alert_reads r where r.alert_id=a.id and r.profile_id=private.current_profile_id() and r.alert_type=a.alert_type;
 update report.cellcare_pastoral_alerts set status='ACKNOWLEDGED',acknowledged_at=coalesce(acknowledged_at,now()) where id=a.id and status='OPEN';
 return v_at;
end $$;

-- 화면용(담임 목사님·담임 사모님·관리자): 열린 경고 + 최근 14일 안에 해결된 경고 + 2주 이상 보고 미제출 셀
-- 메일 기록은 관리자에게만 보낸다
create or replace function report.cellcare_pastoral_board() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.current_profile_id(); adm boolean; result jsonb; miss jsonb;
begin
 if not exists(select 1 from public.profiles where id=me and active) or not (private.is_senior() or private.is_admin()) then
   raise exception '담임 목사님·담임 사모님·관리자만 볼 수 있습니다.' using errcode='42501';
 end if;
 adm := private.is_admin();
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',a.id,'cell_id',a.cell_id,'cell_name',coalesce(nullif(btrim(c.name),''),nullif(btrim(a.cell_name),''),'셀 정보 없음'),
   'cell_leader_name',coalesce(nullif(btrim(a.cell_leader_name),''),'셀리더 정보 없음'),'leadership_name',coalesce(nullif(btrim(a.leadership_name),''),'담당 교역자 정보 없음'),
   'alert_type',a.alert_type,'status',a.status,'consecutive_weeks',a.consecutive_weeks,'gap_weeks',a.gap_weeks,'first_missed_week',a.first_missed_week,'last_missed_week',a.last_missed_week,
   'last_meeting_date',a.last_meeting_date,'latest_report_id',a.latest_report_id,'created_at',a.created_at,'level_changed_at',a.level_changed_at,
   'resolved_at',a.resolved_at,'resolved_reason',a.resolved_reason,
   'me_read',exists(select 1 from report.cellcare_pastoral_alert_reads r where r.alert_id=a.id and r.profile_id=me and r.alert_type=a.alert_type),
   'reads',(select coalesce(jsonb_agg(jsonb_build_object('role',r.role,'name',p.name,'read_at',r.read_at) order by r.role),'[]') from report.cellcare_pastoral_alert_reads r join public.profiles p on p.id=r.profile_id where r.alert_id=a.id and r.alert_type=a.alert_type),
   'emails',case when adm then (select coalesce(jsonb_agg(jsonb_build_object('level',l.alert_level,'recipient',l.recipient,'status',l.status,'attempts',l.attempts,'error',l.error_message,'sent_at',l.sent_at,'at',l.updated_at) order by l.updated_at),'[]') from report.cellcare_pastoral_alert_email_logs l where l.alert_id=a.id) end
 ) order by (a.status='RESOLVED'),(a.alert_type='URGENT_PASTORAL_ATTENTION') desc,a.consecutive_weeks desc,a.level_changed_at desc),'[]') into result
 from report.cellcare_pastoral_alerts a left join public.cells c on c.id=a.cell_id
 where a.status<>'RESOLVED' or a.resolved_at>now()-interval '14 days';
 select coalesce(jsonb_agg(jsonb_build_object('cell_id',y.id,'cell_name',y.name,'missing_weeks',s.missing_weeks,'missing_since',s.missing_since,
   'leader_names',coalesce(pp.leader_names,'셀리더 정보 없음'),'leadership_names',coalesce(pp.leadership_names,'담당 교역자 정보 없음')) order by s.missing_weeks desc,y.name),'[]') into miss
 from public.cells y cross join lateral report.cellcare_consecutive_missed_meetings(y.id) s cross join lateral report.cellcare_cell_people(y.id) pp
 where y.active is true and s.missing_weeks>=2;
 return jsonb_build_object('alerts',result,'missing',miss);
end $$;

revoke all on function report.cellcare_week_deadline(date,text),report.cellcare_consecutive_missed_meetings(uuid,timestamptz),report.cellcare_cell_people(uuid,date) from public,anon,authenticated;
revoke all on function report.cellcare_pastoral_evaluate(boolean,timestamptz),report.cellcare_pastoral_email_due(timestamptz),
  report.cellcare_pastoral_email_claim(uuid,text,text[]),report.cellcare_pastoral_email_result(uuid,text,text,boolean,text) from public,anon,authenticated;
grant execute on function report.cellcare_pastoral_evaluate(boolean,timestamptz),report.cellcare_pastoral_email_due(timestamptz),
  report.cellcare_pastoral_email_claim(uuid,text,text[]),report.cellcare_pastoral_email_result(uuid,text,text,boolean,text) to service_role;
revoke all on function report.cellcare_pastoral_alert_ack(uuid),report.cellcare_pastoral_board() from public,anon;
grant execute on function report.cellcare_pastoral_alert_ack(uuid),report.cellcare_pastoral_board() to authenticated;
commit;
