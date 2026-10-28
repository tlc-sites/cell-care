import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, report } from './_pastoral-db.mjs';
const u = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const KST = (d) => d + 'T10:00:00+09:00';   // 그날 한국 시간 오전 10시
const evaluate = async (db, day, dry = false) => (await db.query('select * from report.cellcare_pastoral_evaluate($1,$2)', [dry, KST(day)])).rows;
const alerts = async (db, cell) => (await db.query('select * from report.cellcare_pastoral_alerts where cell_id=$1 order by created_at', [cell])).rows;
const actor = (db, n) => db.exec(`set test.actor='${n ? u(n) : ''}'`);

test('연속 미모임 판정: 2주 생성 → 3주 긴급 → 4주 갱신 → 모임 시 해결 → 다시 2주면 새 경고, 미제출은 따로', async () => {
  const db = await makeDb();
  try {
    // 주차는 월요일. 기준일 2026-10-24(토): 마감이 지난 최근 주는 10-19 주
    await report(db, u(11), '2026-10-05', true);
    await report(db, u(11), '2026-10-12', false);
    await report(db, u(11), '2026-10-19', false);
    await report(db, u(12), '2026-10-05', true);                       // 은혜셀: 10-12, 10-19 보고서 없음
    await report(db, u(13), '2026-10-12', true); await report(db, u(13), '2026-10-19', false);
    await report(db, u(14), '2026-10-12', false); await report(db, u(14), '2026-10-19', false); // 닫힌 셀은 판정하지 않음

    const streak = async (cell, day) => (await db.query('select * from report.cellcare_consecutive_missed_meetings($1,$2)', [cell, KST(day)])).rows[0];
    let s = await streak(u(11), '2026-10-24');
    assert.equal(s.missed_weeks, 2); assert.equal(s.missing_weeks, 0); assert.equal(s.last_meeting_date.toISOString().slice(0, 10), '2026-10-05');
    s = await streak(u(12), '2026-10-24');
    assert.equal(s.missed_weeks, 0, 'Case 4: 미제출은 미모임이 아님'); assert.equal(s.missing_weeks, 2);
    // 금요일 마감 전에는 이번 주를 미제출로 세지 않는다
    assert.equal((await streak(u(12), '2026-10-23')).missing_weeks, 1);

    // 미리보기(dry)는 아무것도 바꾸지 않는다
    assert.equal((await evaluate(db, '2026-10-24', true)).find(r => r.cell_id === u(11)).action, 'created');
    assert.equal((await alerts(db, u(11))).length, 0);

    // Case 1
    let out = await evaluate(db, '2026-10-24');
    assert.equal(out.find(r => r.cell_id === u(11)).action, 'created');
    assert.equal(out.some(r => r.cell_id === u(12) && r.action !== 'none'), false, 'Case 4: 은혜셀은 경고 없음');
    assert.equal(out.some(r => r.cell_id === u(13) && r.action !== 'none'), false, '1주는 경고 없음');
    assert.equal(out.some(r => r.cell_id === u(14)), false);
    let [a] = await alerts(db, u(11));
    assert.equal(a.alert_type, 'PASTORAL_ATTENTION'); assert.equal(a.status, 'OPEN'); assert.equal(a.consecutive_weeks, 2);
    assert.equal(a.cell_leader_name, '김사랑'); assert.equal(a.leadership_name, '김교역 전도사');
    const firstId = a.id;

    // 같은 판정을 다시 돌려도 그대로
    out = await evaluate(db, '2026-10-24');
    assert.equal(out.find(r => r.cell_id === u(11)).action, 'none');
    assert.equal((await alerts(db, u(11))).length, 1);

    // Case 2: 3주째 → 같은 경고가 긴급으로
    await report(db, u(11), '2026-10-26', false);
    out = await evaluate(db, '2026-10-31');
    assert.equal(out.find(r => r.cell_id === u(11)).action, 'escalated');
    [a] = await alerts(db, u(11));
    assert.equal(a.id, firstId); assert.equal(a.alert_type, 'URGENT_PASTORAL_ATTENTION'); assert.equal(a.consecutive_weeks, 3);

    // Case 10: 4주째 → 새 경고 없이 주 수만
    await report(db, u(11), '2026-11-02', false);
    out = await evaluate(db, '2026-11-07');
    assert.equal(out.find(r => r.cell_id === u(11)).action, 'updated');
    let list = await alerts(db, u(11));
    assert.equal(list.length, 1); assert.equal(list[0].consecutive_weeks, 4); assert.equal(list[0].alert_type, 'URGENT_PASTORAL_ATTENTION');

    // 다음 주 보고서가 미제출이면 해결로 보지 않는다
    out = await evaluate(db, '2026-11-14');
    assert.equal((await alerts(db, u(11)))[0].status, 'OPEN');

    // 보고서 사이에 미제출 주가 끼어도 미제출 주는 세지 않고(gap), 연속은 이어 본다
    await report(db, u(11), '2026-11-16', false);
    await evaluate(db, '2026-11-21');
    a = (await alerts(db, u(11)))[0];
    assert.equal(a.consecutive_weeks, 5); assert.equal(a.gap_weeks, 1);

    // Case 3: 모임 진행 → 해결
    await report(db, u(11), '2026-11-23', true);
    out = await evaluate(db, '2026-11-28');
    assert.equal(out.find(r => r.cell_id === u(11)).action, 'resolved');
    a = (await alerts(db, u(11)))[0];
    assert.equal(a.status, 'RESOLVED'); assert.equal(a.resolved_reason, 'MEETING_HELD');

    // 다시 2주 → 새 경고
    await report(db, u(11), '2026-11-30', false); await report(db, u(11), '2026-12-07', false);
    out = await evaluate(db, '2026-12-12');
    assert.equal(out.find(r => r.cell_id === u(11)).action, 'created');
    list = await alerts(db, u(11));
    assert.equal(list.length, 2); assert.equal(list[1].status, 'OPEN'); assert.equal(list[1].alert_type, 'PASTORAL_ATTENTION');

    // 열린 경고는 셀마다 하나뿐(DB가 막음)
    await assert.rejects(db.query(`insert into report.cellcare_pastoral_alerts(cell_id,alert_type,consecutive_weeks) values($1,'PASTORAL_ATTENTION',2)`, [u(11)]), /duplicate key/);

    // 셀이 닫히면 열린 경고는 해결로
    await db.query('update public.cells set active=false where id=$1', [u(11)]);
    await evaluate(db, '2026-12-13');
    assert.equal((await alerts(db, u(11)))[1].resolved_reason, 'CELL_CLOSED');
  } finally { await db.close(); }
});

test('두 분 각자 확인, 긴급으로 올라가면 다시 확인 전, 보고서를 읽어도 경고는 그대로', async () => {
  const db = await makeDb();
  try {
    await report(db, u(11), '2026-10-05', true);
    const r1 = await report(db, u(11), '2026-10-12', false);
    await report(db, u(11), '2026-10-19', false);
    await report(db, u(12), '2026-09-28', true);
    await evaluate(db, '2026-10-24');
    const board = async () => (await db.query('select report.cellcare_pastoral_board() as b')).rows[0].b;

    // Case 7: 교역자·담임 목사님이 보고서를 읽어도 경고 확인·해결이 아님
    for (const n of [3, 1]) { await actor(db, n); await db.query('select report.cellcare_report_open($1)', [r1]); }
    await actor(db, 1);
    let b = await board();
    assert.equal(b.alerts.length, 1); assert.equal(b.alerts[0].status, 'OPEN'); assert.equal(b.alerts[0].me_read, false);
    assert.equal(b.alerts[0].emails, null, '메일 기록은 관리자만');
    // 화면의 보고 미제출은 지금 시각 기준이라 주 수는 실행 날짜에 따라 늘어난다
    const grace = b.missing.find(x => x.cell_name === '은혜셀');
    assert.ok(grace && grace.missing_weeks >= 3, '보고 미제출은 따로'); assert.equal(grace.leader_names, '이은혜');
    assert.equal(b.alerts.some(x => x.cell_name === '은혜셀'), false, '미제출 셀은 미모임 경고가 아님');

    // 목사님이 확인 → ACKNOWLEDGED, 사모님에게는 아직 확인 전
    const id = b.alerts[0].id;
    await db.query('select report.cellcare_pastoral_alert_ack($1)', [id]);
    await db.query('select report.cellcare_pastoral_alert_ack($1)', [id]); // 두 번 눌러도 한 줄
    b = await board();
    assert.equal(b.alerts[0].status, 'ACKNOWLEDGED'); assert.equal(b.alerts[0].me_read, true); assert.equal(b.alerts[0].reads.length, 1);
    await actor(db, 2);
    assert.equal((await board()).alerts[0].me_read, false);

    // 교역자·셀리더는 확인 표시도, 화면 자료도 못 본다
    for (const n of [3, 5]) {
      await actor(db, n);
      await assert.rejects(db.query('select report.cellcare_pastoral_alert_ack($1)', [id]), /담임 목사님·담임 사모님만/);
      await assert.rejects(db.query('select report.cellcare_pastoral_board()'), /볼 수 있습니다/);
    }

    // 긴급으로 올라가면 다시 확인 전(OPEN), 2주째 확인 기록은 남는다
    await report(db, u(11), '2026-10-26', false);
    await evaluate(db, '2026-10-31');
    await actor(db, 1);
    b = await board();
    assert.equal(b.alerts[0].alert_type, 'URGENT_PASTORAL_ATTENTION'); assert.equal(b.alerts[0].status, 'OPEN'); assert.equal(b.alerts[0].me_read, false);
    assert.equal((await db.query('select count(*)::int n from report.cellcare_pastoral_alert_reads')).rows[0].n, 1);

    // 관리자는 메일 기록을 본다
    await actor(db, 7);
    assert.deepEqual((await board()).alerts[0].emails, []);

    // 직접 테이블·서버 전용 함수는 막혀 있다
    const priv = async (sql) => (await db.query(sql)).rows[0].ok;
    for (const t of ['cellcare_pastoral_alerts', 'cellcare_pastoral_alert_reads', 'cellcare_pastoral_alert_email_logs', 'cellcare_report_reads'])
      assert.equal(await priv(`select has_table_privilege('authenticated','report.${t}','select') ok`), false, t);
    for (const f of ['cellcare_pastoral_evaluate(boolean,timestamptz)', 'cellcare_pastoral_email_due(timestamptz)', 'cellcare_pastoral_email_claim(uuid,text,text[])',
      'cellcare_pastoral_email_result(uuid,text,text,boolean,text)', 'cellcare_consecutive_missed_meetings(uuid,timestamptz)'])
      assert.equal(await priv(`select has_function_privilege('authenticated','report.${f}','execute') ok`), false, f);
    assert.equal(await priv(`select has_function_privilege('service_role','report.cellcare_pastoral_evaluate(boolean,timestamptz)','execute') ok`), true);
    assert.equal(await priv(`select has_function_privilege('anon','report.cellcare_pastoral_board()','execute') ok`), false);
  } finally { await db.close(); }
});

test('메일: 단계마다 한 번, 같은 판정을 다시 돌려도 중복 없음, 실패는 기록하고 3번까지 다시 시도', async () => {
  const db = await makeDb();
  try {
    await report(db, u(11), '2026-10-05', true);
    await report(db, u(11), '2026-10-12', false); await report(db, u(11), '2026-10-19', false);
    await evaluate(db, '2026-10-24');
    const due = async (day) => (await db.query('select * from report.cellcare_pastoral_email_due($1)', [KST(day)])).rows;
    const claim = async (id, level, to) => (await db.query('select recipient from report.cellcare_pastoral_email_claim($1,$2,$3)', [id, level, to])).rows.map(r => r.recipient);
    const result = (id, level, to, ok, err) => db.query('select report.cellcare_pastoral_email_result($1,$2,$3,$4,$5)', [id, level, to, ok, err || null]);

    // Case 11
    let d = await due('2026-10-24');
    assert.equal(d.length, 1); assert.equal(d[0].alert_level, 'PASTORAL_ATTENTION'); assert.equal(d[0].cell_name, '사랑셀');
    const id = d[0].alert_id;
    assert.deepEqual((await claim(id, 'PASTORAL_ATTENTION', ['P@example.com', 's@example.com', ' p@example.com '])).sort(), ['p@example.com', 's@example.com']);
    assert.deepEqual(await claim(id, 'PASTORAL_ATTENTION', ['p@example.com']), [], '보내는 중인 주소는 다시 잡지 않음');
    await result(id, 'PASTORAL_ATTENTION', 'p@example.com', true);
    // Case 15: 한 분 실패 → 경고는 그대로, 실패 기록
    await result(id, 'PASTORAL_ATTENTION', 's@example.com', false, 'SMTP timeout');
    let [a] = await alerts(db, u(11));
    assert.ok(a.initial_email_sent_at); assert.equal(a.status, 'OPEN');
    let logs = (await db.query('select recipient,status,error_message,attempts from report.cellcare_pastoral_alert_email_logs order by recipient')).rows;
    assert.deepEqual(logs.map(l => [l.recipient, l.status]), [['p@example.com', 'SENT'], ['s@example.com', 'FAILED']]);
    assert.equal(logs[1].error_message, 'SMTP timeout');

    // Case 12: 같은 판정을 다시 → 이미 보낸 분은 빠지고 실패한 분만 다시
    await evaluate(db, '2026-10-24');
    d = await due('2026-10-24');
    assert.equal(d.length, 1);
    assert.deepEqual(await claim(id, 'PASTORAL_ATTENTION', ['p@example.com', 's@example.com']), ['s@example.com']);
    await result(id, 'PASTORAL_ATTENTION', 's@example.com', false, 'again');
    assert.deepEqual(await claim(id, 'PASTORAL_ATTENTION', ['s@example.com']), ['s@example.com']);
    await result(id, 'PASTORAL_ATTENTION', 's@example.com', false, 'third');
    assert.deepEqual(await claim(id, 'PASTORAL_ATTENTION', ['s@example.com']), [], '3번 실패하면 멈춤');
    assert.equal((await due('2026-10-24')).length, 0);

    // Case 13: 긴급 상향 → 긴급 메일 한 번
    await report(db, u(11), '2026-10-26', false);
    await evaluate(db, '2026-10-31');
    d = await due('2026-10-31');
    assert.equal(d.length, 1); assert.equal(d[0].alert_level, 'URGENT_PASTORAL_ATTENTION'); assert.equal(d[0].consecutive_weeks, 3);
    assert.deepEqual((await claim(id, 'URGENT_PASTORAL_ATTENTION', ['p@example.com', 's@example.com'])).length, 2);
    await result(id, 'URGENT_PASTORAL_ATTENTION', 'p@example.com', true); await result(id, 'URGENT_PASTORAL_ATTENTION', 's@example.com', true);
    assert.ok((await alerts(db, u(11)))[0].urgent_email_sent_at);
    // 지난 단계 주소로 다시 잡을 수 없음
    assert.deepEqual(await claim(id, 'PASTORAL_ATTENTION', ['s@example.com']), []);

    // Case 14: 4주째 → 메일 없음
    await report(db, u(11), '2026-11-02', false);
    await evaluate(db, '2026-11-07');
    assert.equal((await due('2026-11-07')).length, 0);
    assert.equal((await alerts(db, u(11)))[0].consecutive_weeks, 4);

    // 메일 설정을 늦게 켜도 14일 지난 단계는 보내지 않는다
    await report(db, u(12), '2026-10-12', false); await report(db, u(12), '2026-10-19', false);
    await evaluate(db, '2026-10-24');
    assert.equal((await due('2026-11-20')).filter(x => x.cell_id === u(12)).length, 0);
    assert.equal((await due('2026-10-25')).filter(x => x.cell_id === u(12)).length, 1);
  } finally { await db.close(); }
});
