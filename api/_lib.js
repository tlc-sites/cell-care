// 서버 쪽 공통 (Vercel 함수). 비밀 키는 Vercel 환경 변수에서만 읽습니다.
const webpush = require('web-push');
const SUPABASE_URL = 'https://mcbbhsvvzqvtrxlbdcks.supabase.co';
const PUBLISHABLE = 'sb_publishable_hs84BPU44TEcr2wM6boXIw_Saktd9p3';

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error('환경 변수 ' + name + ' 이(가) 비어 있습니다.');
  return v;
}
function setupPush() {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:dohyun4work@gmail.com',
    env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  return webpush;
}
// 서버 전용 키로 Supabase 함수 부르기
async function serviceRpc(fn, args) {
  const key = env('SUPABASE_SECRET_KEY');
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.split('.').length === 3) headers.Authorization = 'Bearer ' + key;   // 예전 형식(service_role JWT)
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(args || {}) });
  const text = await r.text();
  if (!r.ok) throw new Error('Supabase ' + fn + ' ' + r.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}
// 로그인한 사람 확인 (앱에서 보낸 로그인 토큰)
async function authUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: PUBLISHABLE, Authorization: h } });
  if (!r.ok) return null;
  return r.json();
}
async function sendAll(targets, payload) {
  const wp = setupPush();
  let sent = 0, gone = 0, failed = 0;
  for (const t of targets) {
    try {
      await wp.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify(typeof payload === 'function' ? payload(t) : payload), { TTL: 60 * 60 * 12, urgency: 'normal' });
      sent++; await serviceRpc('push_mark', { p_endpoint: t.endpoint, p_gone: false });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { gone++; await serviceRpc('push_mark', { p_endpoint: t.endpoint, p_gone: true }); }
      else failed++;
    }
  }
  return { targets: targets.length, sent, gone, failed };
}
// 한국 날짜 (YYYY-MM-DD)와 요일(0=주일)
function seoulToday() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return { iso: d.toISOString().slice(0, 10), dow: d.getUTCDay(), date: d };
}
module.exports = { serviceRpc, authUser, sendAll, seoulToday, env };
