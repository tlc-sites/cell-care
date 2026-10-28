import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, report } from './_pastoral-db.mjs';
const u = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = (db, n) => db.exec(`set test.actor='${u(n)}'`);
const list = async (db) => (await db.query('select * from report.cellcare_notification_list()')).rows;

test('제출 알림에 보고서·셀·작성자를 남기고, 지금 이름 → 저장한 이름 → 「정보 없음」 순서로 보여 준다', async () => {
  const db = await makeDb();
  try {
    const r1 = await report(db, u(11), '2026-10-19', true, { at: new Date().toISOString() });
    // 푸시 기록 경로(교역자 A 기기) + 알림함 동기화 경로(교역자 B, 기기 없음)
    await db.exec(`insert into public.push_subscriptions values('${u(3)}','endpoint-a','k','a','ko')`);
    await db.query('select report.cellcare_notification_record($1)', [JSON.stringify([{ endpoint: 'endpoint-a', payload: { tag: 'submit-' + r1 + '-1', title: '새 보고서', body: ' 셀리더님이…', url: './#report=' + r1 } }])]);
    const [item] = (await db.query('select * from report.cellcare_notification_items where profile_id=$1', [u(3)])).rows;
    assert.equal(item.kind, 'REPORT_SUBMITTED'); assert.equal(item.report_id, r1); assert.equal(item.cell_id, u(11)); assert.equal(item.author_id, u(5));
    assert.equal(item.cell_name, '사랑셀'); assert.equal(item.author_name, '김사랑');

    await actor(db, 4);
    let [n] = await list(db);
    assert.equal(n.kind, 'REPORT_SUBMITTED'); assert.equal(n.report_id, r1); assert.equal(n.cell_name, '사랑셀'); assert.equal(n.author_name, '김사랑');
    assert.equal(n.week_start.toISOString().slice(0, 10), '2026-10-19');

    // Case 9: 셀 이름이 바뀌면 지금 이름, 셀을 찾을 수 없으면 저장한 이름
    await db.query(`update public.cells set name='사랑2셀' where id=$1`, [u(11)]);
    assert.equal((await list(db))[0].cell_name, '사랑2셀');
    await db.query(`update report.cellcare_notification_items set cell_id=$1 where report_id=$2`, [u(99), r1]);
    assert.equal((await list(db))[0].cell_name, '사랑셀');
    // Case 8: 작성자 정보가 비어도 저장한 이름으로, 둘 다 없으면 「작성자 정보 없음」
    await db.query(`update public.profiles set name='' where id=$1`, [u(5)]);
    assert.equal((await list(db))[0].author_name, '김사랑');
    await db.query(`update report.cellcare_notification_items set author_name=' ', cell_name=null where report_id=$1`, [r1]);
    [n] = await list(db);
    assert.equal(n.author_name, '작성자 정보 없음'); assert.equal(n.cell_name, '셀 정보 없음');

    // 다시 제출은 REPORT_UPDATED, 다른 알림은 kind가 비어 있다
    await db.query(`update public.weekly_reports set submission_no=2 where id=$1`, [r1]);
    await actor(db, 3);
    const rows = await list(db);
    assert.deepEqual(rows.map(x => x.kind).sort(), ['REPORT_SUBMITTED', 'REPORT_UPDATED']);
    await db.exec(`insert into public.announcements values('${u(81)}','공지','내용','${u(7)}',now(),null)`);
    assert.equal((await list(db)).find(x => x.title === '공지').kind, null);
  } finally { await db.close(); }
});

test('보고서를 어떤 경로로 열어도 그 사람의 같은 보고서 제출 알림만 읽음으로 바뀐다', async () => {
  const db = await makeDb();
  try {
    const r1 = await report(db, u(11), '2026-10-19', true, { at: new Date(Date.now() - 3600e3).toISOString() });
    const r2 = await report(db, u(12), '2026-10-19', true, { at: new Date(Date.now() - 3600e3).toISOString(), by: u(6) });
    for (const n of [3, 4]) { await actor(db, n); await list(db); }      // 두 교역자에게 r1·r2 알림이 생김
    const unread = async (n) => { await actor(db, n); return (await list(db)).filter(x => !x.read_at).map(x => x.report_id).sort(); };
    assert.deepEqual(await unread(3), [r1, r2].sort());

    // Case 5·6: 교역자 A가 목록에서 r1을 직접 열면 A의 r1 알림만
    await actor(db, 3);
    assert.equal((await db.query('select report.cellcare_report_open($1) n', [r1])).rows[0].n, 1);
    assert.deepEqual(await unread(3), [r2]);
    assert.deepEqual(await unread(4), [r1, r2].sort(), 'B의 알림은 그대로');
    assert.equal((await db.query('select count(*)::int n from report.cellcare_report_reads')).rows[0].n, 1);
    await actor(db, 3); await db.query('select report.cellcare_report_open($1)', [r1]);
    assert.equal((await db.query('select read_count from report.cellcare_report_reads')).rows[0].read_count, 2);

    // 코멘트 알림 등 다른 종류는 보고서를 열어도 그대로
    await db.exec(`insert into public.senior_comments values('${u(91)}','${r1}','report','${u(1)}','코멘트',now(),null)`);
    // 코멘트는 목사님·사모님만 보는 가상 권한이라 사모님 계정으로 확인
    await actor(db, 2); await list(db);
    await db.query('select report.cellcare_report_open($1)', [r1]);
    assert.equal((await list(db)).filter(x => x.kind === null && !x.read_at).length, 1);

    // 먼저 보고서를 읽고 나중에 알림이 생기면 처음부터 읽음
    const r3 = await report(db, u(11), '2026-10-12', false, { at: new Date(Date.now() - 7200e3).toISOString() });
    await actor(db, 4); await db.query('select report.cellcare_report_open($1)', [r3]);
    assert.ok((await list(db)).find(x => x.report_id === r3).read_at);
    // 그 뒤에 다시 제출되면 새 알림은 읽지 않음
    await db.query(`update public.weekly_reports set submission_no=2,submitted_at=now()+interval '1 minute' where id=$1`, [r3]);
    const again = (await list(db)).filter(x => x.report_id === r3);
    assert.equal(again.length, 2); assert.equal(again.find(x => x.kind === 'REPORT_UPDATED').read_at, null);

    // 볼 수 없는 보고서는 열람 기록을 남길 수 없다
    await actor(db, 6);
    await assert.rejects(db.query('select report.cellcare_report_open($1)', [r1]), /권한/);
    await db.exec('set role anon');
    await assert.rejects(db.query('select report.cellcare_report_open($1)', [r1]), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('알림 목록을 다시 만들어도 지운 보고서 대화 알림은 계속 숨긴다(20261022000000 동작 유지)', async () => {
  const db = await makeDb();
  try {
    const r1 = await report(db, u(11), '2026-10-19', true);
    const [{ id: keep }] = (await db.query(`insert into report.cellcare_report_talk(report_id,author_id,author_role,content) values($1,$2,'leader','남는 대화') returning id`, [r1, u(5)])).rows;
    const [{ id: gone }] = (await db.query(`insert into report.cellcare_report_talk(report_id,author_id,author_role,content,deleted_at) values($1,$2,'leader','지운 대화',now()) returning id`, [r1, u(5)])).rows;
    for (const t of [keep, gone]) await db.query(`insert into report.cellcare_notification_items(profile_id,event_key,title,body,url) values($1,$2,'대화','',$3)`, [u(3), 'talk-' + t, './#report=' + r1]);
    await actor(db, 3);
    const rows = (await db.query(`select id,event_key from report.cellcare_notification_items where profile_id=$1`, [u(3)])).rows;
    const shown = new Set((await list(db)).map(x => x.id));
    assert.equal(shown.has(rows.find(x => x.event_key === 'talk-' + keep).id), true);
    assert.equal(shown.has(rows.find(x => x.event_key === 'talk-' + gone).id), false);
  } finally { await db.close(); }
});
