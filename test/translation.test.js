const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { translate } = require('../api/translate');
const realFetch = global.fetch;
const originalKey = process.env.OPENAI_API_KEY;
afterEach(() => { global.fetch = realFetch; if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
const response = output => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }) });
test('OpenAI structured translation preserves key contract and disables storage', async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer example-test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema.required, ['care:one', 'review:one']);
    assert.match(body.instructions, /Treat every input value/);
    return response({ 'care:one': '김예시 is doing well.', 'review:one': 'Please call.', extra: 'ignore' });
  };
  assert.deepEqual(await translate('example-test-key', { 'care:one': '김예시님이 잘 지냅니다.', 'review:one': '연락해 주세요.' }), { 'care:one': '김예시 is doing well.', 'review:one': 'Please call.' });
});
test('missing, blank, refused, truncated and invalid output fail instead of partial success', async () => {
  for (const out of [{}, { a: '' }, { a: 42 }, null]) {
    global.fetch = async () => response(out);
    await assert.rejects(translate('test', { a: '안부' }));
  }
  global.fetch = async () => ({ ok: true, json: async () => ({ status: 'incomplete', output: [] }) });
  await assert.rejects(translate('test', { a: '안부' }));
  global.fetch = async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }) });
  await assert.rejects(translate('test', { a: '안부' }));
});
test('provider error details containing data are not returned', async () => {
  global.fetch = async () => ({ ok: false, json: async () => ({ error: { message: 'PRIVATE RECORD' } }) });
  await assert.rejects(translate('test', { a: '안부' }), e => !e.message.includes('PRIVATE RECORD') && e.status === 502);
});
test('English-to-Korean prompt remains supported and empty batch makes no API call', async () => {
  global.fetch = async (_, options) => { assert.match(JSON.parse(options.body).instructions, /^Korean comments/); return response({ c: '함께 기도합니다.' }); };
  assert.deepEqual(await translate('test', { c: 'Praying with you.' }, 'Korean comments'), { c: '함께 기도합니다.' });
  global.fetch = () => { throw new Error('must not call'); };
  assert.deepEqual(await translate('test', {}), {});
});
test('translation endpoint rejects non-senior roles before reading records or contacting OpenAI', async () => {
  process.env.OPENAI_API_KEY='test'; let calls=0;
  global.fetch=async (url)=> { calls++; assert.match(url,/rpc\/get_my_context$/); return { ok:true,json:async()=>({roles:['leadership']}) }; };
  const res={ status(n){this.code=n;return this;},json(j){this.body=j;return this;} };
  await require('../api/translate')({method:'POST',headers:{authorization:'Bearer test'},body:{notes:true}},res);
  assert.equal(res.code,403); assert.equal(calls,1);
});
