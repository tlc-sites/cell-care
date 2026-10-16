// Email-safe HTML: table layout, inline styles, no JavaScript or remote assets.
const APP_URL = 'https://tlc-cell-care.vercel.app/';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\r?\n/g, '<br>');
function monday(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
function translationItems(data) {
  const items = {};
  const add = (key, text) => { if (text && String(text).trim()) items[key] = String(text); };
  (data.messages || []).forEach((m, i) => { if (!m.content_en) add('msg:' + i, m.content); });
  (data.pastoral_reports || []).forEach((r, i) => {
    add('lr:' + i, r.summary);
    (r.items || []).forEach((it, j) => add(`lr:${i}:${j}`, it.content));
  });
  (data.notes || []).forEach((n, i) => { add('note:' + i, n.content); add('np:' + i, n.prayer); });
  (data.reports || []).forEach((r, i) => {
    add('grace:' + i, r.grace_notes); add('cancel:' + i, r.meeting_cancel_reason);
    add('request:' + i, r.leader_message_note);
    (r.care || []).forEach((n, j) => { add(`care:${i}:${j}`, n.content); add(`cp:${i}:${j}`, n.prayer); });
    (r.prayers || []).forEach((p, j) => { add(`pr:${i}:${j}`, p.content); add(`pu:${i}:${j}`, p.this_week_note); });
    (r.new_prayers || []).forEach((p, j) => add(`newpr:${i}:${j}`, p.content));
    (r.reviews || []).forEach((v, j) => add(`rv:${i}:${j}`, v.review_note));
  });
  return items;
}
async function translateEmail(data, translate, key) {
  const entries = Object.entries(translationItems(data));
  if (entries.length && !key.trim()) throw new Error('OpenAI translation is not configured.');
  const result = {};
  // Preserve complete values, with bounded batches; never truncate care records.
  const batches = []; let batch = {}, size = 0;
  for (const [k, v] of entries) {
    if (size && (size + v.length > 8000 || Object.keys(batch).length >= 40)) {
      batches.push(batch); batch = {}; size = 0;
    }
    batch[k] = v; size += v.length;
  }
  if (size) batches.push(batch);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, async () => {
    while (next < batches.length) {
      const current = batches[next++];
      Object.assign(result, await translate(key, current));
    }
  }));
  return Object.fromEntries(entries.map(([k]) => [k, result[k]]));
}
function renderEmail(data, lang = 'ko', tx = {}) {
  const en = lang === 'en', t = (ko, eng) => en ? eng : ko;
  const text = (k, original, savedEnglish) => {
    if (!original) return '';
    const translated = en && (savedEnglish || tx[k]);
    return translated ? nl(translated) + '<div style="font-size:12px;color:#6b7280;margin-top:5px">' + nl(original) + '</div>' : nl(original);
  };
  const card = (title, body) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px;border:1px solid #dde3ec;border-radius:10px;background:white"><tr><td style="padding:18px"><strong>${esc(title)}</strong><div style="margin-top:8px;line-height:1.65">${body}</div></td></tr></table>`;
  const section = (title, body) => `<h2 style="font-size:18px;margin:28px 0 12px;color:#22344e">${esc(title)}</h2>${body || '<p style="color:#6b7280">' + t('이번 주 기록이 없습니다.', 'No records this week.') + '</p>'}`;
  const label = (ko, eng, body) => body ? `<div style="margin-top:10px"><b>${t(ko, eng)}</b><br>${body}</div>` : '';
  const categories = { update: ['근황', 'Update'], prayer: ['기도', 'Prayer'], faith: ['신앙', 'Faith'], health: ['건강', 'Health'], family: ['가정', 'Family'], work_school: ['직장·학업', 'Work / school'], relationship: ['관계', 'Relationships'], long_absence: ['장기 결석', 'Long absence'], care_needed: ['돌봄 필요', 'Care needed'], other: ['기타', 'Other'] };
  const cat = k => categories[k] ? t(...categories[k]) : String(k || '');
  const submitted = (data.status || []).filter(r => r.status === 'submitted').length;
  const reports = data.reports || [], notes = data.notes || [];
  const attention = [];
  reports.forEach((r, i) => {
    const levels = { attention: ['관심 필요', 'Needs attention'], pastoral: ['목양 확인 필요', 'Pastoral follow-up'], urgent: ['긴급 확인 필요', 'Urgent'] };
    if (levels[r.escalation_level]) {
      const j = (r.reviews || []).length - 1;
      attention.push(card(r.cell_name + ' · ' + t(...levels[r.escalation_level]), j >= 0 ? text(`rv:${i}:${j}`, r.reviews[j].review_note) : t('앱에서 보고서를 확인해 주세요.', 'Please review the report in the app.')));
    }
    if (r.leader_message && r.leader_message !== 'none') attention.push(card(r.cell_name + ' · ' + t('셀리더 요청', 'Leader request'), esc(({ contact: t('연락·상담 필요', 'Contact / counselling needed') })[r.leader_message] || r.leader_message) + '<br>' + text('request:' + i, r.leader_message_note)));
    (r.care || []).forEach((n, j) => { if (n.leadership_attention_required) attention.push(card(r.cell_name + ' · ' + n.person_name, text(`care:${i}:${j}`, n.content) + label('기도제목', 'Prayer', text(`cp:${i}:${j}`, n.prayer)))); });
  });
  notes.forEach((n, i) => { if (n.needs_pastor && !n.i_acked) attention.push(card(n.person_name + ' · ' + t('성도 동정 확인', 'Pastoral note to review'), text('note:' + i, n.content))); });
  const present = reports.reduce((n, r) => n + (r.present || 0), 0);
  const stats = [[`${submitted} / ${(data.status || []).length}`, t('셀보고서 제출', 'Cell reports')], [present, t('모임 참석', 'Present')], [attention.length, t('확인 필요', 'To review')], [notes.length, t('성도 동정', 'Pastoral notes')]];
  const stamp = data.generated_at ? new Date(data.generated_at).toLocaleString(en ? 'en-GB' : 'ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '';
  let body = `<p style="letter-spacing:2px;color:#64748b;font-size:12px">TLC · CELL CARE</p><h1 style="font-size:26px;margin:8px 0">${t('한 주의 셀 소식', 'This week in Cell Care')}</h1><p style="color:#64748b">${esc(data.week)} · ${stamp ? esc(stamp) + t(' 기준', ' KST') : t('금요일 주간 보고', 'Friday weekly report')}</p><p><a href="${APP_URL}" style="color:#294668">${t('셀 케어에서 자세히 보기', 'Open Cell Care')}</a></p>`;
  body += '<table role="presentation" width="100%" cellpadding="10" style="background:#eaf0f7;border-radius:10px;text-align:center"><tr>' + stats.slice(0, 2).map(([v, k]) => `<td width="50%"><b style="font-size:22px">${esc(v)}</b><br><span style="font-size:12px">${k}</span></td>`).join('') + '</tr><tr>' + stats.slice(2).map(([v, k]) => `<td><b style="font-size:22px">${esc(v)}</b><br><span style="font-size:12px">${k}</span></td>`).join('') + '</tr></table>';
  body += section(t('담임목사님께 드리는 말씀', 'Messages for Pastor Scott Brenner'), (data.messages || []).map((m, i) => card((m.author || '') + ' · ' + (m.cell_name || ''), text('msg:' + i, m.content, m.content_en))).join(''));
  body += section(t('확인이 필요한 것', 'Needs your review'), attention.join(''));
  body += section(t('교역자 보고', 'Pastoral reports'), (data.pastoral_reports || []).map((r, i) => card(r.author_name || '', text('lr:' + i, r.summary) + (r.items || []).map((it, j) => `<div style="margin-top:14px"><b>${esc(it.person_name)}</b> <span style="color:#64748b;font-size:12px">${esc(it.group_name)} · ${esc(cat(it.category))}</span><br>${text(`lr:${i}:${j}`, it.content)}</div>`).join(''))).join('') + (data.pastoral_status || []).filter(r => r.status !== 'submitted').map(r => `<p style="color:#64748b">${esc(r.author_name)} · ${t('아직 작성 전', 'Not yet submitted')}</p>`).join(''));
  const methods = { in_person: ['대면 심방', 'In person'], phone: ['전화 심방', 'Phone call'], text: ['문자 심방', 'Text message'], other: ['기타', 'Other'] };
  body += section(t('이번 주 성도 동정', 'Pastoral notes this week'), notes.map((n, i) => card(n.person_name || '', `<div style="font-size:12px;color:#64748b">${esc(n.met_on)} · ${esc(methods[n.visit_method] ? t(...methods[n.visit_method]) : '')} · ${esc(cat(n.category))}${n.needs_pastor ? ' · ' + (n.i_acked ? t('확인 완료', 'Reviewed') : t('확인 필요', 'Needs review')) : ''}</div>` + text('note:' + i, n.content) + label('기도제목', 'Prayer', text('np:' + i, n.prayer)))).join(''));
  const groups = new Map();
  reports.forEach((r, i) => {
    const group = r.group_name || t('담당 미지정', 'Unassigned');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(card(r.cell_name || '', `<div style="font-size:12px;color:#64748b">${esc(r.meeting_date || '')} · ${t('참석', 'Present')} ${r.present || 0} · ${t('결석', 'Absent')} ${r.absent || 0}</div>` +
      label('모임을 못한 이유', 'Meeting cancelled', text('cancel:' + i, r.meeting_cancel_reason)) +
      label('은혜와 나눔', 'Grace & sharing', text('grace:' + i, r.grace_notes)) +
      (r.care || []).map((n, j) => label(n.person_name || '셀 케어', n.person_name || 'Cell care', esc((n.categories || [n.category]).map(cat).join(', ')) + '<br>' + text(`care:${i}:${j}`, n.content) + label('기도제목', 'Prayer', text(`cp:${i}:${j}`, n.prayer)) + (n.related_name ? '<div>' + esc(n.related_name) + ' · ' + (n.relation_kind === 'one_way' ? t('상대 때문에 어려움', 'Troubled by this person') : t('서로 어려워함', 'Mutual difficulty')) + '</div>' : ''))).join('') +
      (r.prayers || []).map((p, j) => label(p.member_name || '기도제목', p.member_name || 'Prayer request', text(`pr:${i}:${j}`, p.content) + '<br>' + text(`pu:${i}:${j}`, p.this_week_note))).join('') +
      (r.new_prayers || []).map((p, j) => label(p.person_name || '기도제목', p.person_name || 'Prayer request', text(`newpr:${i}:${j}`, p.content))).join('') +
      (r.reviews || []).map((v, j) => label('확인 메모 (목사님·사모님께 전할 내용)', 'Review note (for Pastor & Mrs. Brenner)', text(`rv:${i}:${j}`, v.review_note))).join('')));
  });
  let cells = [...groups].map(([name, cards]) => `<h3 style="font-size:15px;color:#64748b">${esc(name)}</h3>${cards.join('')}`).join('');
  cells += (data.status || []).filter(r => r.status !== 'submitted').map(r => `<p style="color:#64748b">${esc(r.cell_name)} · ${t('미제출', 'Not submitted')}</p>`).join('');
  body += section(t('셀별 보고', 'Cell reports'), cells);
  body += `<p style="text-align:center;margin:30px 0"><a href="${APP_URL}" style="display:inline-block;background:#294668;color:white;padding:14px 24px;border-radius:7px;text-decoration:none">${t('셀 케어에서 자세히 보기', 'Open Cell Care')}</a></p><p style="font-size:12px;color:#64748b;line-height:1.6">${t('목양을 위한 개인적인 기록이 포함되어 있습니다. 다른 분께 전달하지 말아 주세요. 메일 작성 이후 고친 내용은 앱에서 확인해 주세요.', 'This email contains private pastoral care records. Please do not forward it. Changes made after this email was prepared are available in the app.')}</p>`;
  const html = `<!doctype html><html lang="${en ? 'en' : 'ko'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f5f8;color:#243247;font-family:Arial,'Malgun Gothic',sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px"><tr><td style="padding:28px 18px">${body}</td></tr></table></td></tr></table></body></html>`;
  return { subject: t('[셀 케어] ', '[Cell Care] ') + data.week + t(' 주간 보고', ' weekly report'), html,
    text: body.replace(/<br\s*\/?>/g, '\n').replace(/<\/(div|p|h[123]|table)>/g, '\n').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') + '\n' + APP_URL };
}
module.exports = { renderEmail, translateEmail, translationItems, monday };
