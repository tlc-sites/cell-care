import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeDb, report } from './_pastoral-db.mjs';
const require = createRequire(import.meta.url);
const pastoral = require('../api/_pastoral.js');
const u = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 서버 함수가 부르는 RPC를 가상 DB 함수로 그대로 연결
const rpcOf = (db) => async (fn, args) => {
  const keys = Object.keys(args || {});
  const sql = `select * from report.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')})`;
  return (await db.query(sql, keys.map(k => args[k]))).rows;
};
// 지금 시각 기준 n주 전 월요일(한국 날짜)
function monday(weeksAgo) {
  const d = new Date(Date.now() + 9 * 3600e3); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * weeksAgo);
  return d.toISOString().slice(0, 10);
}
const ENV = { PASTORAL_ALERT_EMAILS: 'pastor@example.com, samonim@example.com' };

test('메일: 경고를 먼저 저장하고 두 분께 각각 보냄 → 다시 실행해도 중복 없음 → 긴급 때 한 번 더 → 4주째는 없음', async () => {
  const db = await makeDb();
  try {
    const rpc = rpcOf(db), sent = [];
    const send = async (to, subject, html, text) => { sent.push({ to, subject, html, text }); return { sent: to }; };
    await report(db, u(11), monday(4), true);
    await report(db, u(11), monday(3), false); await report(db, u(11), monday(2), false);

    // 미리보기는 아무것도 저장·발송하지 않는다
    const dry = await pastoral.run({ dry: true }, { rpc, send, env: ENV });
    assert.equal(dry.evaluated.find(r => r.cell_id === u(11)).action, 'created');
    assert.equal(sent.length, 0);
    assert.equal((await db.query('select count(*)::int n from report.cellcare_pastoral_alerts')).rows[0].n, 0);

    // Case 11
    let out = await pastoral.run({}, { rpc, send, env: ENV });
    assert.deepEqual(sent.map(m => m.to).sort(), ['pastor@example.com', 'samonim@example.com']);
    assert.equal(sent[0].subject, '[셀 케어] 사랑셀 2주 연속 셀모임 미진행 확인');
    for (const t of ['김사랑', '김교역 전도사', '연속 미모임', '2주', '목회적 확인 필요', '#report=']) assert.ok(sent[0].html.includes(t), t);
    assert.ok(!sent[0].html.includes('긴급 확인이 필요한 셀입니다'));
    assert.equal(out.emails.sent, 2);
    assert.ok((await db.query('select initial_email_sent_at from report.cellcare_pastoral_alerts')).rows[0].initial_email_sent_at);

    // Case 12
    out = await pastoral.run({}, { rpc, send, env: ENV });
    assert.equal(sent.length, 2); assert.equal(out.emails.due, 0);

    // Case 13
    await report(db, u(11), monday(1), false);
    await pastoral.run({}, { rpc, send, env: ENV });
    assert.equal(sent.length, 4);
    assert.equal(sent[2].subject, '[긴급 셀 케어] 사랑셀 3주 연속 셀모임 미진행');
    assert.ok(sent[2].html.includes('긴급 확인이 필요한 셀입니다.'));

    // Case 14
    await report(db, u(11), monday(0), false);
    await pastoral.run({}, { rpc, send, env: ENV });
    assert.equal(sent.length, 4);
    assert.equal((await db.query('select consecutive_weeks from report.cellcare_pastoral_alerts')).rows[0].consecutive_weeks, 4);
  } finally { await db.close(); }
});

test('메일 실패·설정 없음에도 경고는 저장되고, 실패는 기록만 한다 (Case 15)', async () => {
  const db = await makeDb();
  try {
    const rpc = rpcOf(db);
    await report(db, u(11), monday(3), false); await report(db, u(11), monday(2), false);

    // 받는 분 설정이 없으면 보내지 않고 자리도 잡지 않는다
    let out = await pastoral.run({}, { rpc, send: async () => { throw new Error('should not send'); }, env: {} });
    assert.equal(out.emails.skipped, 'PASTORAL_ALERT_EMAILS 미설정');
    assert.equal((await db.query('select count(*)::int n from report.cellcare_pastoral_alerts')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int n from report.cellcare_pastoral_alert_email_logs')).rows[0].n, 0);

    // 한 분은 실패
    const send = async (to) => { if (to.startsWith('samonim')) throw new Error('535 auth failed'); return { sent: to }; };
    out = await pastoral.run({}, { rpc, send, env: ENV });
    assert.equal(out.emails.sent, 1); assert.equal(out.emails.failed, 1);
    const logs = (await db.query('select recipient,status,error_message from report.cellcare_pastoral_alert_email_logs order by recipient')).rows;
    assert.deepEqual(logs.map(l => [l.recipient, l.status]), [['pastor@example.com', 'SENT'], ['samonim@example.com', 'FAILED']]);
    assert.match(logs[1].error_message, /535/);
    const [a] = (await db.query('select status,alert_type from report.cellcare_pastoral_alerts')).rows;
    assert.deepEqual([a.status, a.alert_type], ['OPEN', 'PASTORAL_ATTENTION']);

    // 결과 기록이 실패해도 실행 전체는 실패하지 않는다
    const broken = async (fn, args) => { if (fn === 'cellcare_pastoral_email_result') throw new Error('db down'); return rpc(fn, args); };
    out = await pastoral.run({}, { rpc: broken, send: async (to) => ({ sent: to }), env: ENV });
    assert.equal(out.emails.sent, 1, '실패했던 분에게만 다시');
  } finally { await db.close(); }
});

test('받는 주소 정리와 메일 내용', () => {
  assert.deepEqual(pastoral.recipients(' A@x.org; b@y.org,a@x.org  nope '), ['a@x.org', 'b@y.org']);
  const m = pastoral.buildMail({ alert_level: 'PASTORAL_ATTENTION', cell_name: '<사랑셀>', consecutive_weeks: 2, gap_weeks: 1, cell_leader_name: null, leadership_name: '박교역', latest_report_id: null, latest_week: '2026-10-19', last_meeting_date: null });
  assert.ok(m.html.includes('&lt;사랑셀&gt;')); assert.ok(!m.html.includes('<사랑셀>'));
  assert.ok(m.text.includes('셀리더: 셀리더 정보 없음')); assert.ok(m.text.includes('2026년 10월 3주차'));
  assert.ok(m.text.includes('중간 보고 미제출 1주는 세지 않음'));
});
