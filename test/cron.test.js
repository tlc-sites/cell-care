const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../lib/cron-weekly-email');
const data = require('./fixtures');
const originalFetch = global.fetch, originalNow = Date.now, originalEnv = { ...process.env };
afterEach(() => { global.fetch = originalFetch; Date.now = originalNow; process.env = { ...originalEnv }; });
const response = value => ({ ok: true, json: async () => value, text: async () => JSON.stringify(value) });
function env() {
  Object.assign(process.env, { CRON_SECRET: 'example-cron-secret', WEEKLY_EMAIL_ENABLED: 'true',
    SUPABASE_SECRET_KEY: 'example-service-key', WEEKLY_EMAIL_FROM: 'church@example.org',
    GMAIL_CLIENT_ID: 'test', GMAIL_CLIENT_SECRET: 'test', GMAIL_REFRESH_TOKEN: 'test', OPENAI_API_KEY: 'example-test-key' });
  Date.now = () => Date.parse('2026-10-16T08:00:00Z');
}
async function invoke(authorization = 'Bearer example-cron-secret', method = 'GET') {
  const res = { code: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.code=n; return this; }, json(body) { this.body=body; return this; } };
  await handler({ method, headers: { authorization } },res); return res;
}
test('cron requires secret, GET, enabled flag and Friday 17 KST before any data access', async () => {
  env(); global.fetch = () => { throw new Error('must not fetch'); };
  assert.equal((await invoke('wrong')).code,401);
  assert.equal((await invoke(undefined,'POST')).code,405);
  process.env.WEEKLY_EMAIL_ENABLED='false'; assert.equal((await invoke()).body.skipped,'disabled');
  process.env.WEEKLY_EMAIL_ENABLED='true'; Date.now=()=>Date.parse('2026-10-16T07:59:59Z');
  assert.match((await invoke()).body.skipped,/outside/);
  Date.now=()=>Date.parse('2026-10-17T08:00:00Z'); assert.match((await invoke()).body.skipped,/outside/);
});
function transport({ sendFails=false, claimed=true, snapshotFails=false, lang='ko' } = {}) {
  const events=[]; let sends=0;
  global.fetch = async (url,options) => {
    if (url.includes('/rest/v1/rpc/')) {
      const fn=url.split('/').at(-1), args=JSON.parse(options.body); events.push([fn,args]);
      if (fn==='weekly_email_recipients') return response([{ auth_user_id:data.auth_user_id,email:'pastor@example.org',lang }]);
      if (fn==='weekly_email_claim') return response(claimed ? 'claim-test' : null);
      if (fn==='weekly_email_snapshot') { if (snapshotFails) throw new Error('PRIVATE RECORD'); return response(data); }
      return response(null);
    }
    if (url.includes('oauth2.googleapis.com')) return response({ access_token:'example-token' });
    if (url.includes('gmail.googleapis.com')) {
      sends++; events.push(['gmail']);
      assert.equal(events.at(-2)[1].p_state,'sending');
      const raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString();
      assert.match(raw,/To: pastor@example.org/);
      if (sendFails) throw new Error('timeout, provider may have accepted');
      return response({ id:'gmail-example' });
    }
    if (url.includes('api.openai.com')) {
      const items=JSON.parse(JSON.parse(options.body).input);
      return response({ status:'completed',output:[{ type:'message',content:[{ type:'output_text',text:JSON.stringify(Object.fromEntries(Object.keys(items).map(k=>[k,'Example English translation']))) }] }] });
    }
    throw new Error('unexpected external call');
  };
  return { events, sends:()=>sends };
}
test('cron renders and sends individually, records sent after Gmail, repeated claim skips', async () => {
  env(); const fake=transport({ lang:'en' }); const res=await invoke();
  assert.equal(res.code,200); assert.equal(res.body.sent,1); assert.equal(fake.sends(),1);
  assert.deepEqual(fake.events.filter(([fn])=>fn==='weekly_email_mark').map(([,args])=>args.p_state),['sending','sent']);
  const duplicate=transport({ claimed:false }); assert.equal((await invoke()).body.skipped,1); assert.equal(duplicate.sends(),0);
});
test('ambiguous send is uncertain without retry; pre-send failure is retryable and redacted', async () => {
  env(); const fake=transport({ sendFails:true }); const res=await invoke();
  assert.equal(res.code,502); assert.equal(res.body.uncertain,1); assert.equal(fake.sends(),1);
  assert.equal(fake.events.at(-1)[1].p_state,'uncertain');
  const pre=transport({ snapshotFails:true }); const failed=await invoke();
  assert.equal(failed.body.failed,1); assert.equal(pre.sends(),0); assert.equal(pre.events.at(-1)[1].p_state,'failed');
  assert.ok(!JSON.stringify(failed.body).includes('PRIVATE'));
});
