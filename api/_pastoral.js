// (api/cron.js?job=pastoral 로 불림 — Vercel 무료 요금제 함수 12개 제한 때문에 합침)
// 셀모임 2주 이상 연속 미진행 → 목회적 케어 보고 (매일, Vercel Cron, CRON_SECRET 필요)
//  1. DB에서 판정하고 경고를 만들거나 바꿈(cellcare_pastoral_evaluate). 여기서 실패하면 메일도 보내지 않음
//  2. 그 뒤에 메일: 받는 분은 PASTORAL_ALERT_EMAILS(쉼표로 여러 주소). 보내는 메일은 GMAIL_USER / GMAIL_APP_PASSWORD
//     메일이 실패해도 경고는 DB에 그대로 남고, 실패는 기록만 함
//  ?dryRun=1 : 아무것도 바꾸지 않고 판정 결과만 돌려줌
const { serviceRpc, env } = require('./_lib');
const APP_URL = 'https://tlc-cell-care.vercel.app/';
// 자동으로 메일을 보내는 단계. 4주째 이후 추가 메일이 필요하면 단계를 더하고 DB의 단계 기준(cellcare_pastoral_email_due)도 함께 바꾼다
const EMAIL_LEVELS = ['PASTORAL_ATTENTION', 'URGENT_PASTORAL_ATTENTION'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateText = (v) => v ? String(v).slice(0, 10) : '';
function weekText(iso, lang) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return lang === 'en' ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + y + ', Week ' + Math.ceil(d / 7) : y + '년 ' + m + '월 ' + Math.ceil(d / 7) + '주차';
}
function recipients(value) {
  return [...new Set(String(value || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)))];
}

function buildMail(a) {
  const urgent = a.alert_level === 'URGENT_PASTORAL_ATTENTION';
  const cell = a.cell_name || '셀 정보 없음';
  const weeks = a.consecutive_weeks;
  const subject = urgent ? `[긴급 셀 케어] ${cell} ${weeks}주 연속 셀모임 미진행` : `[셀 케어] ${cell} ${weeks}주 연속 셀모임 미진행 확인`;
  const link = a.latest_report_id ? APP_URL + '#report=' + a.latest_report_id : APP_URL;
  const rows = [
    ['셀리더', 'Cell leader', a.cell_leader_name || '셀리더 정보 없음'],
    ['담당 교역자(분파셀리더)', 'Leadership in charge', a.leadership_name || '담당 교역자 정보 없음'],
    ['연속 미모임', 'Weeks without meeting', weeks + '주' + (a.gap_weeks ? ` (중간 보고 미제출 ${a.gap_weeks}주는 세지 않음)` : '')],
    ['마지막 확인된 모임', 'Last meeting on record', dateText(a.last_meeting_date) || '기록 없음'],
    ['최근 보고', 'Latest report', weekText(a.latest_week, 'ko')],
    ['현재 상태', 'Status', urgent ? '긴급 확인' : '목회적 확인 필요'],
  ];
  const red = '#B42318', amber = '#B54708';
  const td = 'padding:7px 6px;border-top:1px solid #EEF1F5;font-size:15px;vertical-align:top';
  const html = `<div style="background:#F5F7FA;padding:20px 12px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111827;line-height:1.6">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #E3E7EE;border-left:6px solid ${urgent ? red : amber};border-radius:12px;padding:18px 20px">
  <div style="font-size:13px;color:#6B7280">TLC 셀 케어 · 목회적 케어 보고</div>
  ${urgent ? `<div style="margin:10px 0;padding:10px 12px;border-radius:8px;background:#FDECEC;color:${red};font-weight:700;font-size:16px">긴급 확인이 필요한 셀입니다.</div>` : ''}
  <h1 style="font-size:20px;margin:8px 0">${esc(cell)}의 셀모임 미진행이 ${weeks}주 연속 확인되었습니다.</h1>
  <table style="width:100%;border-collapse:collapse">${rows.map(r => `<tr><td style="${td};color:#6B7280;width:42%">${esc(r[0])}</td><td style="${td}"><b>${esc(r[2])}</b></td></tr>`).join('')}</table>
  <div style="text-align:center;margin:20px 0 6px"><a href="${esc(link)}" style="display:inline-block;background:#1F2A44;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">최근 셀 케어 보고서 보기</a></div>
  <p style="font-size:13px;color:#6B7280;margin:14px 0 0">보고서에 저장된 「셀모임 진행 여부」로 자동 판정했습니다. 보고서를 제출하지 않은 주는 미모임으로 세지 않습니다. 셀 케어 앱 「전체 현황」에서 「확인했습니다」를 누르시면 확인 기록이 남습니다.</p>
  <hr style="border:none;border-top:1px solid #EEF1F5;margin:16px 0">
  <div style="font-size:14px;color:#374151">${urgent ? `<b style="color:${red}">Urgent: this cell needs your attention.</b><br>` : ''}
  <b>${esc(cell)}</b> has not met for <b>${weeks}</b> week(s) in a row (based on submitted reports).<br>
  ${rows.slice(0, 2).map(r => esc(r[1]) + ': ' + esc(r[2])).join(' · ')}<br>
  Last meeting on record: ${esc(dateText(a.last_meeting_date) || '—')} · Latest report: ${esc(weekText(a.latest_week, 'en'))}</div>
  </div></div>`;
  const text = [urgent ? '긴급 확인이 필요한 셀입니다.\n' : '', `${cell}의 셀모임 미진행이 ${weeks}주 연속 확인되었습니다.`, '',
    ...rows.map(r => r[0] + ': ' + r[2]), '', '최근 셀 케어 보고서 확인: ' + link].join('\n');
  return { subject, html, text };
}

async function run({ dry = false } = {}, deps = {}) {
  const rpc = deps.rpc || serviceRpc;
  const send = deps.send || require('./_digest').sendMail;
  const vars = deps.env || process.env;
  const evaluated = await rpc('cellcare_pastoral_evaluate', { p_dry: !!dry });
  const changed = (evaluated || []).filter(r => r.action !== 'none');
  if (dry) return { dry: true, evaluated };
  const to = recipients(vars.PASTORAL_ALERT_EMAILS);
  const due = ((await rpc('cellcare_pastoral_email_due', {})) || []).filter(a => EMAIL_LEVELS.includes(a.alert_level));
  const emails = { due: due.length, sent: 0, failed: 0 };
  if (!due.length) return { changed, emails };
  // 설정이 없으면 자리를 잡지 않고 건너뜀 → 설정한 뒤 14일 안의 경고는 다음 실행에 보냄
  if (!to.length) return { changed, emails: { ...emails, skipped: 'PASTORAL_ALERT_EMAILS 미설정' } };
  if (!deps.send && !(vars.GMAIL_USER && vars.GMAIL_APP_PASSWORD)) return { changed, emails: { ...emails, skipped: 'GMAIL_USER / GMAIL_APP_PASSWORD 미설정' } };
  for (const a of due) {
    let claimed = [];
    try { claimed = ((await rpc('cellcare_pastoral_email_claim', { p_alert: a.alert_id, p_level: a.alert_level, p_recipients: to })) || []).map(r => r.recipient); }
    catch (e) { emails.failed++; console.error('pastoral email claim failed:', a.alert_id, String(e.message || e)); continue; }
    const mail = buildMail(a);
    for (const r of claimed) {
      let ok = false, error = null;
      try {
        const out = await send(r, mail.subject, mail.html, mail.text);
        if (out && out.skipped) throw new Error(out.skipped);
        ok = true; emails.sent++;
      } catch (e) { error = String(e.message || e); emails.failed++; console.error('pastoral email failed:', a.alert_id, a.alert_level, error); }
      try { await rpc('cellcare_pastoral_email_result', { p_alert: a.alert_id, p_level: a.alert_level, p_recipient: r, p_ok: ok, p_error: error }); }
      catch (e) { console.error('pastoral email result not saved:', a.alert_id, String(e.message || e)); }
    }
  }
  return { changed, emails };
}

const handler = async (req, res) => {
  try {
    if ((req.headers.authorization || '') !== 'Bearer ' + env('CRON_SECRET')) return res.status(401).json({ error: 'unauthorized' });
    const dry = /^(1|true)$/.test(String((req.query && req.query.dryRun) || ''));
    res.status(200).json(await run({ dry }));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
module.exports = handler;
module.exports.run = run;
module.exports.buildMail = buildMail;
module.exports.recipients = recipients;
