const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const senior = '00000000-0000-0000-0000-000000000001';
const leader = '00000000-0000-0000-0000-000000000002';
const report = '00000000-0000-0000-0000-000000000003';
// Minimal contracts copied from the inspected database, with entirely fictional data.
const setup = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.profiles(id uuid primary key, auth_user_id uuid, active boolean, name text);
create table public.user_roles(user_id uuid,role text);
create function private.current_profile_id() returns uuid language sql stable as $$ select id from public.profiles where auth_user_id=auth.uid() and active $$;
create function private.has_role(r text) returns boolean language sql stable as $$ select exists(select 1 from public.user_roles where user_id=private.current_profile_id() and role=r) $$;
create function private.is_senior() returns boolean language sql stable as $$ select private.has_role('senior_pastor') or private.has_role('samonim') $$;
create function private.can_read_report(id uuid) returns boolean language sql stable as $$ select private.is_senior() $$;
create function private.can_oversee_report(id uuid) returns boolean language sql stable as $$ select private.is_senior() and coalesce(current_setting('test.own_cell',true),'') <> 'true' $$;
create function private.can_read_pastoral_note(id uuid) returns boolean language sql stable as $$ select private.is_senior() $$;
create table public.weekly_reports(id uuid primary key,status text, meeting_date date,meeting_cancel_reason text,grace_notes text,leader_message text,leader_message_note text);
create table public.cell_members(id uuid primary key,name text);
create table public.care_notes(id uuid primary key,report_id uuid,member_id uuid,related_member_id uuid,related_name text,content text,created_at timestamptz);
create table public.prayer_requests(report_id uuid,member_id uuid,content text);
create table public.leadership_reviews(report_id uuid,submission_no int,review_note text);
create table public.pastoral_notes(id uuid,met_on date,person_name text,category text,content text,prayer text,needs_pastor boolean,visit_method text,campus text,created_at timestamptz);
create table public.pastoral_note_acks(note_id uuid,profile_id uuid);
create function public.get_week_status(w date) returns table(cell_name text, responsible_leadership_name text,report_id uuid,status text,members_present int,visitors_present int,members_absent int) language sql as $$ select 'Example cell','Example leader',id,status,7,1,2 from public.weekly_reports $$;
create function public.lr_overview(w date) returns table(author_name text,report_id uuid,status text) language sql as $$ select 'Example leader',null::uuid,'none' where false $$;
create function public.lr_read(id uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.pastor_msgs_week(w date) returns table(report_id uuid,content text) language sql as $$ select id,'Example message' from public.weekly_reports $$;
create function public.get_open_prayers(id uuid) returns table(member_name text,content text,this_week_note text) language sql as $$ select 'Example member','Example prayer','Example update' $$;
insert into auth.users values ('${senior}','pastor@example.org',now()),('${leader}','leader@example.org',now());
insert into public.profiles values ('${senior}','${senior}',true,'Example pastor'),('${leader}','${leader}',true,'Example leader');
insert into public.user_roles values ('${senior}','senior_pastor'),('${leader}','leadership');
insert into public.weekly_reports values ('${report}','submitted','2026-10-13',null,'Example grace','none',null);
insert into public.leadership_reviews values ('${report}',1,'PRIVATE REVIEW');
`;
test('PostgreSQL migration: recipient eligibility, permission boundaries, snapshot and delivery state', async () => {
  const db = new PGlite();
  try {
    await db.exec(setup);
    await db.exec(fs.readFileSync(path.join(__dirname, '../db/weekly-email.sql'), 'utf8'));
    const scalar = async (sql, args) => (await db.query(sql,args)).rows[0]?.value;
    assert.deepEqual((await db.query('select * from weekly_email_recipients()')).rows, []);
    await db.exec(`insert into weekly_email_settings values ('${senior}','ko',true),('${leader}','en',true)`);
    const recipients = (await db.query('select * from weekly_email_recipients()')).rows;
    assert.equal(recipients.length,1); assert.equal(recipients[0].lang,'en');
    await assert.rejects(db.query('select weekly_email_claim($1,$2)', ['2026-10-12',leader]));
    await assert.rejects(db.query('select weekly_email_claim($1,$2)', ['2026-10-13',senior]));
    const id = await scalar('select weekly_email_claim($1,$2) as value',['2026-10-12',senior]); assert.ok(id);
    assert.equal(await scalar('select weekly_email_claim($1,$2) as value',['2026-10-12',senior]),null);
    await db.query('select weekly_email_mark($1,$2,$3)',[id,'failed',null]);
    const retry = await scalar('select weekly_email_claim($1,$2) as value',['2026-10-12',senior]); assert.notEqual(retry,id);
    await assert.rejects(db.query('select weekly_email_mark($1,$2,$3)',[id,'sending','stale']));
    await db.query('select weekly_email_mark($1,$2,$3)',[retry,'sending','example-message']);
    await db.query('select weekly_email_mark($1,$2,$3)',[retry,'uncertain',null]);
    assert.equal(await scalar('select weekly_email_claim($1,$2) as value',['2026-10-12',senior]),null);
    // New week can send, sent rows never re-claim.
    const next = await scalar('select weekly_email_claim($1,$2) as value',['2026-10-19',senior]);
    await db.query('select weekly_email_mark($1,$2,$3)',[next,'sending','next']);
    await db.query('select weekly_email_mark($1,$2,$3)',[next,'sent','gmail-id']);
    assert.equal(await scalar('select weekly_email_claim($1,$2) as value',['2026-10-19',senior]),null);
    await db.exec(`select set_config('request.jwt.claim.sub','${leader}',false); select set_config('request.jwt.claims','{"sub":"${leader}"}',false)`);
    const snapshot = await scalar('select weekly_email_snapshot($1,$2) as value',['2026-10-12',senior]);
    assert.equal(snapshot.reports[0].present,8); assert.equal(snapshot.reports[0].reviews[0].review_note,'PRIVATE REVIEW');
    assert.equal(await scalar("select current_setting('request.jwt.claim.sub') as value"),leader);
    await db.exec("select set_config('test.own_cell','true',false)");
    const own = await scalar('select weekly_email_snapshot($1,$2) as value',['2026-10-12',senior]);
    assert.deepEqual(own.reports[0].reviews,[]);
    await db.exec(`update weekly_reports set status='draft'`);
    const draft = await scalar('select weekly_email_snapshot($1,$2) as value',['2026-10-12',senior]);
    assert.equal(draft.reports.length,0); assert.equal(draft.messages.length,0);
    await db.exec(`update profiles set active=false where id='${senior}'`);
    assert.equal((await db.query('select * from weekly_email_recipients()')).rows.length,0);
    await assert.rejects(db.query('select weekly_email_snapshot($1,$2)',['2026-10-12',senior]));
    for (const role of ['anon','authenticated']) {
      await db.exec('set role '+role);
      await assert.rejects(db.query('select * from weekly_email_settings'));
      await assert.rejects(db.query('select * from weekly_email_deliveries'));
      await assert.rejects(db.query('select weekly_email_snapshot($1,$2)',['2026-10-12',senior]));
      await assert.rejects(db.query('select weekly_email_claim($1,$2)',['2026-10-12',senior]));
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
