import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261022010000_note_categories_moves_schedule.sql', import.meta.url), 'utf8');
const allStaff = await readFile(new URL('../supabase/migrations/20261023000000_moves_all_staff.sql', import.meta.url), 'utf8');
const u = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 1 A셀 담당 교역자, 2 B셀 담당 교역자, 3 셀리더(교역자 아님), 4 관계없는 교역자, 5 관리자
// 셀 A=21, B=22 / 셀원 31(A, 정식), 32(A, 정식) / 지난 출석은 옛 셀원 행(31)을 가리킨다

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema private; create schema report;
    create table public.profiles(id uuid primary key,name text,active boolean);
    create table public.user_roles(user_id uuid,role text);
    create table public.cells(id uuid primary key,name text,campus text,review_mode text,active boolean,staff_shared boolean default false,meet_day text,meet_time text,meet_place text);
    create table public.cell_members(id uuid primary key default gen_random_uuid(),cell_id uuid,name text,member_type text,active boolean default true,
      first_seen_week date,joined_at date,left_at date,registered_at timestamptz,registered_by uuid,created_by uuid,deleted_at timestamptz,meets_separately boolean default false,on_hold boolean default false);
    create table public.attendance(report_id uuid,member_id uuid,status text);
    create table public.prayer_requests(id uuid primary key default gen_random_uuid(),cell_id uuid,member_id uuid,status text);
    create table public.leadership_assignments(cell_id uuid,leadership_user_id uuid,start_date date,end_date date);
    create table public.pastoral_notes(id uuid primary key default gen_random_uuid(),author_id uuid,person_name text,category text,content text,active boolean default true);
    create table report.cellcare_notification_items(id uuid primary key default gen_random_uuid(),profile_id uuid,event_key text,title text,body text,url text,
      created_at timestamptz default now(),read_at timestamptz,unique(profile_id,event_key));
    create function private.current_profile_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.app_today() returns date language sql as $$select date '2026-10-22'$$;
    create function private.week_start_of(d date) returns date language sql as $$select d - ((extract(isodow from d)::int)-1)$$;
    create function private.has_role(text) returns boolean language sql as $$select exists(select 1 from public.user_roles where user_id=private.current_profile_id() and role=$1)$$;
    create function private.is_admin() returns boolean language sql as $$select private.has_role('admin')$$;
    create function private.is_senior() returns boolean language sql as $$select false$$;
    create function private.is_cell_leadership(p_cell uuid, d date default null) returns boolean language sql as $$
      select private.has_role('leadership') and exists(select 1 from public.leadership_assignments a where a.cell_id=p_cell and a.leadership_user_id=private.current_profile_id()
        and a.start_date<=coalesce(d,private.app_today()) and (a.end_date is null or a.end_date>=coalesce(d,private.app_today())))$$;
    create function private.can_read_pastoral_note(uuid) returns boolean language sql as $$select private.has_role('leadership')$$;
    create function public.pastoral_note_save(p_id uuid,p_met_on date,p_person text,p_category text,p_content text,p_prayer text,p_needs_pastor boolean,
      p_visibility text default 'all',p_viewers uuid[] default '{}',p_method text default 'in_person',p_campus text default '분당') returns uuid language plpgsql as $$
      declare v uuid; begin
        if not private.has_role('leadership') then raise exception '교역자만 성도 동정을 쓸 수 있습니다.'; end if;
        if p_id is null then insert into public.pastoral_notes(author_id,person_name,category,content) values(private.current_profile_id(),p_person,coalesce(p_category,'update'),p_content) returning id into v;
        else update public.pastoral_notes set category=coalesce(p_category,'update'),content=p_content where id=p_id and author_id=private.current_profile_id() returning id into v;
          if v is null then raise exception '쓴 분만 고칠 수 있습니다.'; end if; end if;
        return v; end $$;
    insert into public.profiles values ${[1, 2, 3, 4, 5].map(n => `('${u(n)}','Staff ${n}',true)`).join(',')};
    insert into public.user_roles values('${u(1)}','leadership'),('${u(2)}','leadership'),('${u(4)}','leadership'),('${u(5)}','admin');
    insert into public.cells(id,name,campus,review_mode,active) values('${u(21)}','A셀','분당','leadership',true),('${u(22)}','B셀','분당','leadership',true);
    insert into public.leadership_assignments values('${u(21)}','${u(1)}','2026-01-01',null),('${u(22)}','${u(2)}','2026-01-01',null);
    insert into public.cell_members(id,cell_id,name,member_type,joined_at) values('${u(31)}','${u(21)}','김은혜','member','2026-01-04'),('${u(32)}','${u(21)}','이평안','member','2026-01-04');
    insert into public.attendance values('${u(41)}','${u(31)}','present');
    insert into public.prayer_requests(cell_id,member_id,status) values('${u(21)}','${u(31)}','ongoing'),('${u(21)}','${u(31)}','answered');
  `);
  return db;
}
const as = (db, n) => db.exec(`set test.actor='${u(n)}'`);

test('성도 동정: 이슈 구분을 여러 개 저장하고, 기존 category는 첫 값으로 유지한다', async () => {
  const db = await setup();
  try {
    await db.exec(migration); await db.exec(migration);   // 다시 실행해도 안전
    await db.exec(`insert into public.pastoral_notes(author_id,person_name,category,content) values('${u(1)}','옛 동정','faith','x')`);
    await db.exec(migration);
    assert.deepEqual((await db.query(`select categories from public.pastoral_notes where person_name='옛 동정'`)).rows[0].categories, ['faith']); // 기존 자료 보존
    await as(db, 1);
    const save = (id, cats) => db.query(`select report.cellcare_pastoral_note_save($1,'2026-10-21','김은혜 집사',$2,'내용','',false) as id`, [id, cats]);
    const id = (await save(null, ['health', 'family', 'health', 'nope', 'work_school'])).rows[0].id;
    const row = (await db.query('select category,categories from public.pastoral_notes where id=$1', [id])).rows[0];
    assert.equal(row.category, 'health');
    assert.deepEqual(row.categories, ['health', 'family', 'work_school']);
    assert.deepEqual((await db.query('select * from report.cellcare_note_categories($1)', [[id]])).rows[0].categories, ['health', 'family', 'work_school']);
    await save(id, []);                                      // 하나도 안 고르면 근황
    assert.deepEqual((await db.query('select categories from public.pastoral_notes where id=$1', [id])).rows[0].categories, ['update']);
    await db.exec(`update public.pastoral_notes set category='faith' where id='${id}'`); // 옛 화면이 category만 바꾼 경우
    assert.deepEqual((await db.query('select * from report.cellcare_note_categories($1)', [[id]])).rows[0].categories, ['faith']);
    await as(db, 3);
    assert.equal((await db.query('select * from report.cellcare_note_categories($1)', [[id]])).rows.length, 0);
    await assert.rejects(save(null, ['health']), /교역자만/);
    await as(db, 4);
    await assert.rejects(save(id, ['health']), /쓴 분만/);
  } finally { await db.close(); }
});

test('주요 모임 시간: 담당 교역자·관리자만 바꾼다', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    const set = (cell) => db.query(`select public.cell_set_schedule($1,'금','19:30','교회')`, [cell]);
    await as(db, 3); await assert.rejects(set(u(21)), /담당 교역자/);
    await as(db, 2); await assert.rejects(set(u(21)), /담당 교역자/);
    await as(db, 1); await set(u(21));
    await as(db, 5); await set(u(22));
    assert.deepEqual((await db.query(`select meet_day,meet_time from public.cells order by name`)).rows, [{ meet_day: '금', meet_time: '19:30' }, { meet_day: '금', meet_time: '19:30' }]);
  } finally { await db.close(); }
});

test('셀 이동: 등록만으로는 소속이 바뀌지 않고, 연락 두 가지 후 적용 시점에 옮기며 이력과 과거 기록을 보존한다', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    const create = (member, to = u(22)) => db.query(`select report.cellcare_move_create($1,$2,'2026-10-21','교역자 회의 결정') as id`, [member, to]);
    const list = (h = false) => db.query('select * from report.cellcare_move_list($1)', [h]);
    const contact = (id, k, on = true) => db.query('select report.cellcare_move_contact($1,$2,$3)', [id, k, on]);
    const apply = id => db.query('select report.cellcare_move_apply($1) as id', [id]);

    await as(db, 2); await assert.rejects(create(u(31)), /담당 교역자/);     // 이동 셀 담당은 등록 불가
    await as(db, 3); await assert.rejects(create(u(31)), /담당 교역자/);
    await as(db, 1); await assert.rejects(create(u(31), u(21)), /다시 골라/);
    const opts = (await db.query('select report.cellcare_move_options() as o')).rows[0].o;
    assert.equal(opts.cells.length, 2); assert.equal(opts.members.length, 2);
    assert.equal(opts.cells.find(c => c.id === u(22)).staff, 'Staff 2');     // 담당 교역자 자동 연결
    const mv = (await create(u(31))).rows[0].id;
    await assert.rejects(create(u(31)), /진행 중인 이동 건/);
    assert.equal((await db.query(`select cell_id,left_at from public.cell_members where id='${u(31)}'`)).rows[0].left_at, null); // 등록만으로는 그대로
    let row = (await list()).rows[0];
    assert.equal(row.status, 'contact'); assert.equal(row.from_staff, 'Staff 1'); assert.equal(row.to_staff, 'Staff 2');
    assert.equal((await db.query(`select count(*)::int c from report.cellcare_notification_items where profile_id='${u(2)}'`)).rows[0].c, 1);

    await assert.rejects(apply(mv), /연락을 모두/);
    await as(db, 2);
    assert.equal((await list()).rows.length, 1);                               // 이동 셀 담당도 봄
    await assert.rejects(contact(mv, 'leader'), /기존 셀의 담당/);
    await as(db, 4);
    assert.equal((await list()).rows.length, 0);
    await assert.rejects(apply(mv), /권한|담당/);
    await as(db, 1);
    await contact(mv, 'leader'); await contact(mv, 'member', true);
    await contact(mv, 'member', false);
    assert.equal((await list()).rows[0].status, 'contact');                    // 체크 해제 가능
    await contact(mv, 'member', true);
    assert.equal((await list()).rows[0].status, 'ready');

    await as(db, 2);
    const newId = (await apply(mv)).rows[0].id;
    const old = (await db.query(`select cell_id,left_at::text from public.cell_members where id='${u(31)}'`)).rows[0];
    assert.equal(old.cell_id, u(21)); assert.equal(old.left_at, '2026-10-18');  // 이번 주(10/19)부터 A셀에서 내려감
    const nw = (await db.query('select cell_id,joined_at::text,member_type from public.cell_members where id=$1', [newId])).rows[0];
    assert.equal(nw.cell_id, u(22)); assert.equal(nw.joined_at, '2026-10-19');
    assert.equal((await db.query(`select member_id from public.attendance`)).rows[0].member_id, u(31)); // 지난 출석은 옛(A셀) 기록 그대로
    assert.deepEqual((await db.query(`select cell_id,status from public.prayer_requests order by status`)).rows.map(r => [r.cell_id, r.status]), [[u(21), 'answered'], [u(22), 'ongoing']]);
    assert.equal((await list()).rows.length, 0);                               // 진행 중 목록에서 사라짐
    row = (await list(true)).rows[0];
    assert.equal(row.status, 'done'); assert.equal(row.applied_on.toISOString().slice(0, 10), '2026-10-22');
    assert.equal(row.from_cell_name, 'A셀'); assert.equal(row.to_cell_name, 'B셀');
    await assert.rejects(apply(mv), /진행 중인 이동 건이 아닙니다/);
    assert.equal((await db.query(`select count(*)::int c from report.cellcare_notification_items where profile_id='${u(1)}'`)).rows[0].c, 1);

    // 취소: 등록한 분 또는 기존 셀 담당. 이력에 남는다
    await as(db, 1);
    const mv2 = (await create(u(32))).rows[0].id;
    await as(db, 2); await assert.rejects(db.query(`select report.cellcare_move_cancel($1,'')`, [mv2]), /권한/);
    await as(db, 1); await db.query(`select report.cellcare_move_cancel($1,'결정 번복')`, [mv2]);
    assert.equal((await list(true)).rows.find(r => r.id === mv2).status, 'canceled');
    assert.equal((await db.query(`select left_at from public.cell_members where id='${u(32)}'`)).rows[0].left_at, null);

    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from report.cellcare_member_moves'), /permission denied/);
    await assert.rejects(db.query(`select report.cellcare_move_notify('${mv}','x')`), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('셀 이동(20261023): 교역자는 담당과 관계없이 모든 셀원을 보고 등록·연락·적용·취소한다', async () => {
  const db = await setup();
  try {
    await db.exec(migration); await db.exec(allStaff); await db.exec(allStaff);   // 다시 실행해도 안전
    await db.exec(`insert into public.cell_members(id,cell_id,name,member_type,joined_at) values('${u(33)}','${u(22)}','박소망','member','2026-01-04')`);
    const create = (member, to) => db.query(`select report.cellcare_move_create($1,$2,'2026-10-21','') as id`, [member, to]);
    const list = (h = false) => db.query('select * from report.cellcare_move_list($1)', [h]);
    const opts = async () => (await db.query('select report.cellcare_move_options() as o')).rows[0].o;

    await as(db, 4);                                                              // 어느 셀도 맡지 않은 교역자
    const o = await opts();
    assert.equal(o.cells.length, 2); assert.equal(o.members.length, 3);           // 모든 셀의 셀원
    assert.ok(o.cells.every(c => c.mine === false));
    const mv = (await create(u(31), u(22))).rows[0].id;                          // 남의 셀 셀원 등록
    assert.equal((await opts()).members.length, 2);                               // 진행 중인 분은 고르기 목록에서 빠짐
    const row = (await list()).rows[0];
    assert.equal(row.can_contact, true); assert.equal(row.can_cancel, true); assert.equal(row.can_apply, false);
    await db.query('select report.cellcare_move_contact($1,$2,true)', [mv, 'leader']);
    await db.query('select report.cellcare_move_contact($1,$2,true)', [mv, 'member']);
    assert.equal((await list()).rows[0].can_apply, true);
    await db.query('select report.cellcare_move_apply($1)', [mv]);
    assert.equal((await list(true)).rows[0].status, 'done');
    // 알림은 지금처럼 두 셀 담당 교역자에게(등록·적용 각 1건)
    assert.equal((await db.query(`select count(*)::int c from report.cellcare_notification_items where profile_id='${u(1)}'`)).rows[0].c, 2);
    assert.equal((await db.query(`select count(*)::int c from report.cellcare_notification_items where profile_id='${u(4)}'`)).rows[0].c, 0);

    await as(db, 2);                                                              // B셀 담당이 A셀 셀원 등록 → A셀 담당이 취소
    const mv2 = (await create(u(32), u(22))).rows[0].id;
    await as(db, 1); await db.query(`select report.cellcare_move_cancel($1,'')`, [mv2]);
    assert.equal((await list(true)).rows.find(r => r.id === mv2).status, 'canceled');

    await as(db, 3);                                                              // 셀리더(교역자 아님)는 여전히 불가
    assert.equal(await opts(), null);
    assert.equal((await list(true)).rows.length, 0);
    await assert.rejects(create(u(33), u(21)), /교역자와 관리자만/);
    await as(db, 5); await create(u(33), u(21));                                  // 관리자 가능

    await db.exec('set role authenticated');
    await assert.rejects(db.query('select report.cellcare_move_staff()'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});
