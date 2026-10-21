import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function editor(note) {
  const E = {
    rep: { week_start: '2026-10-19' }, roster: [],
    m: { meeting_held: true, meeting_date: '2026-10-21', meeting_cancel_reason: '',
      grace_none: true, grace_notes: '', leader_message: 'none', att: {}, pu: {},
      hasCare: true, notes: [note] }
  };
  const context = vm.createContext({ E, weekOK: () => true });
  const helpers = html.slice(html.indexOf('function careCategories('), html.indexOf('async function save()'));
  const validate = html.slice(html.indexOf('function validateForSubmit()'), html.indexOf('async function submitReport()'));
  vm.runInContext(helpers + '\n' + validate, context);
  return { validate: () => vm.runInContext('validateForSubmit()', context),
    payload: () => JSON.parse(JSON.stringify(vm.runInContext('payload()', context))) };
}
const note = (changes = {}) => ({ member_id: 'sample-member', categories: [], content: '', prayer: '', attention: false, ...changes });

test('기도제목만 입력하면 유형과 내용 없이 제출하고 기도 유형으로 저장한다', () => {
  const e = editor(note({ prayer: '  회복을 위해 기도해 주세요.  ' }));
  assert.equal(e.validate(), null);
  const p = e.payload();
  assert.equal(p.grace_none, true);
  assert.equal(p.care_notes.length, 1);
  assert.deepEqual(p.care_notes[0].categories, ['prayer']);
  assert.equal(p.care_notes[0].content, '');
  assert.equal(p.care_notes[0].prayer, '회복을 위해 기도해 주세요.');
});
test('기도제목에 직접 선택한 유형은 보존한다', () => {
  const e = editor(note({ prayer: '기도제목', categories: ['health'] }));
  assert.equal(e.validate(), null);
  assert.deepEqual(e.payload().care_notes[0].categories, ['health']);
});
test('일반 나눔 내용은 기존대로 유형을 요구한다', () => {
  assert.equal(editor(note({ content: '나눔' })).validate()[0], 2);
  assert.equal(editor(note({ content: '나눔', categories: ['update'] })).validate(), null);
});
test('기도제목도 셀원을 선택해야 하며 공백은 내용으로 보지 않는다', () => {
  assert.equal(editor(note({ member_id: '', prayer: '기도제목' })).validate()[0], 2);
  assert.equal(editor(note({ prayer: '   ' })).validate()[0], 2);
});
test('완전히 빈 추가 칸은 제출을 막지 않고 저장에서 제외한다', () => {
  const e = editor(note({ member_id: '' }));
  assert.equal(e.validate(), null);
  assert.equal(e.payload().care_notes.length, 0);
});
test('전체 인라인 스크립트 문법을 검사한다', () => {
  for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (m[1].trim()) new vm.Script(m[1]);
  }
});
