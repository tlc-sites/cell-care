import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function problems(m) {
  const E = {
    rep: { week_start: '2026-10-19' }, roster: [],
    m: { meeting_held: true, meeting_date: '2026-10-21', meeting_cancel_reason: '', grace_none: true, grace_notes: '',
      leader_message: 'none', att: {}, pu: {}, hasCare: true, notes: [], ...m }
  };
  const context = vm.createContext({ E, weekOK: (d) => d >= '2026-10-19' && d <= '2026-10-25', dayLabel: (d) => d, addDays: (d) => d });
  const helpers = html.slice(html.indexOf('function careCategories('), html.indexOf('async function save()'));
  const validate = html.slice(html.indexOf('function validateForSubmit()'), html.indexOf('async function submitReport()'));
  vm.runInContext(helpers + '\n' + validate, context);
  // vm 안에서 만든 배열은 다른 realm이라 JSON으로 옮겨 비교
  return JSON.parse(JSON.stringify({ list: vm.runInContext('reportProblems()', context), first: vm.runInContext('validateForSubmit()', context) }));
}
const note = (changes = {}) => ({ member_id: 'm1', categories: [], content: '', prayer: '', attention: false, ...changes });

test('내용만 적고 유형을 안 고르면 그 기록의 유형 칸을 이유와 함께 알려 준다', () => {
  const r = problems({ notes: [note({ categories: ['update'], content: '나눔' }), note({ content: '이직 고민' })] });
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].key, 'note:1:categories');
  assert.equal(r.list[0].step, 2);
  assert.match(r.first[1], /^기록 2: 내용을 적으셨으면 유형을/);
});
test('셀원 없음, 글 없음을 칸마다 따로 알려 준다', () => {
  const r = problems({ notes: [note({ member_id: '', categories: ['health'] })] });
  assert.deepEqual(r.list.map(p => p.key), ['note:0:member_id', 'note:0:text']);
});
test('여러 단계의 문제를 모두 모으고, 처음 보여 줄 곳은 앞 단계부터', () => {
  const r = problems({ meeting_date: '2026-10-01', grace_none: false, notes: [note({ content: '나눔' })] });
  assert.deepEqual(r.list.map(p => [p.step, p.key]), [[0, 'meeting_date'], [2, 'note:0:categories'], [3, 'grace_notes']]);
  assert.equal(r.first[0], 0);
});
test('모임을 못 한 주는 이유 칸을, 진행 여부가 없으면 선택 칸을 알려 준다', () => {
  assert.equal(problems({ meeting_held: false }).list[0].key, 'meeting_cancel_reason');
  assert.equal(problems({ meeting_held: null }).list[0].key, 'meeting_held');
});
test('문제가 없으면 null', () => {
  assert.equal(problems({ notes: [note({ prayer: '기도제목' })] }).first, null);
});
test('검사가 쓰는 모든 칸 이름이 화면에 data-err와 이유 자리로 있다', () => {
  for (const k of ['meeting_held', 'meeting_date', 'meeting_cancel_reason', 'grace_notes']) {
    assert.ok(html.includes(`data-err="${k}"`), k);
    assert.ok(html.includes(`errSlot('${k}')`), k);
  }
  for (const f of ['member_id', 'categories', 'text']) {
    assert.ok(html.includes(`data-err="note:\${i}:${f}"`), f);
    assert.ok(html.includes(`errSlot('note:' + i + ':${f}')`), f);
  }
});
test('다른 입력 화면은 toast만 띄우지 않고 칸을 표시한다', () => {
  assert.doesNotMatch(html, /return toast\(tr\('[^']*(적어|골라) 주세요/);
});
