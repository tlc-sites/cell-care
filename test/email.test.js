const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderEmail, translateEmail, translationItems, monday } = require('../lib/weekly-email');
const { rawMessage } = require('../lib/gmail');
const data = require('./fixtures');
test('full weekly content, review notes, new prayers and original messages render', () => {
  const ko = renderEmail(data);
  for (const s of ['확인 메모', data.reports[0].reviews[0].review_note, data.reports[0].new_prayers[0].content, '박예시', '미제출', '7', 'https://tlc-cell-care.vercel.app/']) assert.ok(ko.html.includes(s), s);
  assert.ok(!ko.html.includes(data.messages[0].content_en));
  const en = renderEmail(data, 'en', { 'grace:0': 'Translated grace' });
  assert.match(en.html, /Our cell members/); assert.match(en.html, /Translated grace/);
  assert.ok(en.html.includes(data.reports[0].grace_notes));
  assert.match(en.text, /Open Cell Care/);
});
test('all user content is HTML escaped; no script-capable links or images', () => {
  const copy = structuredClone(data); copy.messages[0].content = '<script>alert(1)</script>'; copy.messages[0].author = '"><img src=x onerror=alert(1)>';
  const html = renderEmail(copy).html;
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;script&gt;/);
});
test('email translation batches preserve complete fields and all keys', async () => {
  const copy = structuredClone(data); copy.reports[0].grace_notes = '가'.repeat(9000);
  let calls = 0;
  const translated = await translateEmail(copy, async (_, items) => { calls++; return Object.fromEntries(Object.keys(items).map(k => [k, 'translation'])); }, 'test');
  assert.ok(calls > 1); assert.equal(translationItems(copy)['grace:0'].length, 9000);
  assert.deepEqual(Object.keys(translated), Object.keys(translationItems(copy)));
});
test('Gmail MIME has individually addressed UTF-8 HTML and plain alternatives', () => {
  const email = renderEmail(data);
  const raw = rawMessage('church@example.org', 'pastor@example.org', email, 'weekly-2026-10-12@example.org');
  assert.match(raw, /To: pastor@example.org\r\n/); assert.match(raw, /multipart\/alternative/);
  assert.match(raw, /Content-Type: text\/plain/); assert.match(raw, /Content-Type: text\/html/);
  assert.ok(raw.includes(Buffer.from(email.html).toString('base64').slice(0, 60)));
  assert.throws(() => rawMessage('church@example.org', 'pastor@example.org\r\nBcc:bad@example.org', email, 'x@example.org'));
});
test('week calculation uses explicit Seoul date across year boundary', () => {
  assert.equal(monday('2026-10-16'), '2026-10-12'); assert.equal(monday('2027-01-01'), '2026-12-28');
});
