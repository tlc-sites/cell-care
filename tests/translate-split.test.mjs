import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('긴 글 번역: 줄바꿈에서 나눠 여러 번 보내고, 받은 번역을 원래 줄바꿈대로 이어 붙인다', async () => {
  const sent = [], real = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    const items = JSON.parse(JSON.parse(opt.body).messages[0].content); sent.push(Object.values(items).reduce((a, v) => a + v.length, 0));
    const out = {}; for (const [k, v] of Object.entries(items)) out[k] = 'EN' + v.length;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(out) }] }) };
  };
  try {
    const { translate } = require('../api/translate.js');
    const big = ('가'.repeat(3999) + '\n').repeat(5);   // 2만 자
    const r = await translate('k', { a: '짧은 글', b: big, c: '다른 글' });
    assert.equal(r.a, 'EN4'); assert.equal(r.c, 'EN4');
    assert.equal(r.b, 'EN3999\nEN3999\nEN3999\nEN3999\nEN4000');   // 마지막 조각은 끝 줄바꿈 포함
    assert.ok(sent.every(n => n <= 6000)); assert.equal(sent.reduce((a, n) => a + n, 0), 4 + 20000 - 4 + 4);   // 나눈 자리의 줄바꿈 4개는 보내지 않고 이어 붙일 때 넣음
    const one = await translate('k', { x: 'y'.repeat(13000) });  // 줄바꿈 없는 긴 글은 6000자씩
    assert.equal(one.x, 'EN6000EN6000EN1000');
  } finally { globalThis.fetch = real; }
});
