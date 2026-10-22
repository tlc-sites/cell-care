import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function editor(meeting_held) {
  const E = {
    rep: { week_start: '2026-10-19' },
    roster: [{ member_id: 'a', listed: true }, { member_id: 'b', listed: true }, { member_id: 'v', listed: false }],
    m: { meeting_held, meeting_date: meeting_held ? '2026-10-21' : '', meeting_cancel_reason: meeting_held ? '' : '추석 연휴',
      grace_none: false, grace_notes: '', leader_message: 'none',
      att: { a: { status: 'present', absence_reason: '' }, b: { status: 'absent', absence_reason: '출장' }, v: { status: 'present', absence_reason: '' } },
      pu: {}, hasCare: false, notes: [] }
  };
  const context = vm.createContext({ E, weekOK: () => true });
  const helpers = html.slice(html.indexOf('function careCategories('), html.indexOf('async function save()'));
  const validate = html.slice(html.indexOf('function validateForSubmit()'), html.indexOf('async function submitReport()'));
  vm.runInContext(helpers + '\n' + validate, context);
  return { E, validate: () => vm.runInContext('validateForSubmit()', context),
    payload: () => JSON.parse(JSON.stringify(vm.runInContext('payload()', context))) };
}

test('모임을 진행하지 못하면 출석·은혜 입력 없이 제출할 수 있다', () => {
  assert.equal(editor(false).validate(), null);
});
test('모임을 진행하지 못하면 앞서 입력한 출석을 미확인으로 보내 지우고, 화면 입력값은 남긴다', () => {
  const e = editor(false);
  const p = e.payload();
  assert.deepEqual(p.attendance.map(a => a.status), ['unknown', 'unknown', 'unknown']);
  assert.ok(p.attendance.every(a => a.absence_reason === ''));
  assert.equal(e.E.m.att.a.status, 'present');
});
test('모임을 진행하면 출석을 그대로 보낸다', () => {
  const p = editor(true).payload();
  assert.deepEqual(p.attendance.map(a => a.status), ['present', 'absent', 'present']);
  assert.equal(p.attendance[1].absence_reason, '출장');
});
test('출석 단계 건너뛰기는 진행하지 못함일 때만 켜진다', () => {
  const src = html.slice(html.indexOf('const skipAttendance'), html.indexOf('function mondayOf('));
  for (const [held, want] of [[false, true], [true, false], [null, false]]) {
    const ctx = vm.createContext({ E: { m: { meeting_held: held } } });
    vm.runInContext(src + ';globalThis.r = skipAttendance();', ctx);
    assert.equal(ctx.r, want);
  }
});
