// (api/cron-senior.js?job=digest 로 불림 — Vercel 무료 요금제 함수 12개 제한 때문에 합침)
// 주간 요약 메일 (금요일 밤 11:59, Vercel Cron)
//  · 셀보고서 미제출 / 교역자 보고 미제출 (누적 포함) + 이번 주 셀보고서 중요 내용 요약
//  · 받는 분: 담임 목사님(영어) · 사모님(한국어) — 앱에 등록된 이메일. 아직 없으면 DIGEST_EN_TO / DIGEST_KO_TO 에 적은 주소
//  · 보내는 메일: GMAIL_USER / GMAIL_APP_PASSWORD (교회 Gmail 앱 비밀번호). 없으면 보내지 않고 건너뜀
//  · 앱 안 미리보기: POST { preview: 'ko'|'en' } (목사님·사모님·관리자만), 테스트 발송: POST { test: true } (본인에게만)
const { serviceRpc, authUser, seoulToday, env } = require('./_lib');
const SUPABASE_URL = 'https://mcbbhsvvzqvtrxlbdcks.supabase.co';
const PUBLISHABLE = 'sb_publishable_hs84BPU44TEcr2wM6boXIw_Saktd9p3';
const APP_URL = 'https://tlc-cell-care.vercel.app/';
const MODEL = process.env.DIGEST_MODEL || process.env.TRANSLATE_MODEL || 'claude-sonnet-5-5';

const SUMMARY_PROMPT = `You prepare a weekly pastoral summary for the senior pastor and the church office of a Korean church, from cell-group reports.
Input: JSON array of this week's submitted cell reports (care notes per member, prayer requests, attendance, messages to Leadership or the pastor, Leadership review level).
Pick only what matters pastorally: health issues, family crises, relationship conflicts, long absences, newcomers, people needing a visit or counseling, urgent/pastoral escalation, notes flagged for attention, direct requests to the pastor. Skip routine items and ordinary grace sharing.
Reply with JSON only, in this shape:
{"ko": {"highlights": ["..."], "cells": [{"cell": "<cell name exactly>", "points": ["..."]}]},
 "en": {"highlights": ["..."], "cells": [{"cell": "<cell name exactly>", "points": ["..."]}]}}
Rules:
- highlights: 3-6 short bullets for the whole church this week (most important first).
- cells: only cells with something notable; 1-3 short points each, most important first. Omit quiet cells.
- Keep people's names and cell names exactly as written in Korean in BOTH languages (never romanize).
- Korean: natural, warm, concise 존댓말 noun-ending style (e.g. "~하심", "~필요"). English: natural, warm, concise.
- Be factual; do not invent or exaggerate. If nothing notable, return empty arrays.`;

async function summarize(reports) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key || !reports.length) return null;
  const compact = reports.map(r => ({
    cell: r.cell, campus: r.campus, meeting: r.meeting_held === false ? 'not held: ' + (r.cancel_reason || '') : 'held',
    present: r.present, absent: r.absent, escalation: r.escalation || undefined, review_note: r.review_note || undefined,
    to_leadership: r.to_leadership ? r.to_leadership + (r.to_leadership_note ? ': ' + r.to_leadership_note : '') : undefined,
    pastor_message: r.pastor_message || undefined,
    care: r.care.map(c => ({ m: c.member, t: c.topics, c: c.content || undefined, p: c.prayer || undefined, flag: c.attention || undefined }))
  }));
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, system: SUMMARY_PROMPT, messages: [{ role: 'user', content: JSON.stringify(compact) }] })
    });
    const j = await r.json();
    if (!r.ok) return null;
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : text);
  } catch (_) { return null; }
  finally { clearTimeout(timer); }
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function weekName(iso, lang) {
  const [y, m, d] = iso.split('-').map(Number);
  const n = Math.ceil(d / 7);
  return lang === 'en' ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' wk ' + n : m + '월 ' + n + '주';
}
const CAMPUS = { ko: { '분당': '분당·판교', '부산': '부산' }, en: { '분당': 'Bundang·Pangyo', '부산': 'Busan' } };

function buildHtml(D, S, lang) {
  const T = (ko, en) => lang === 'en' ? en : ko;
  const wk = D.week;
  const [y, m, d] = wk.split('-').map(Number);
  const title = T(`${m}월 ${Math.ceil(d / 7)}주 셀 케어 주간 요약`, `Cell Care weekly summary — ${weekName(wk, 'en')}, ${y}`);
  const subOk = D.cells_due - D.missing_cells.filter(x => x.this_week).length;
  const box = 'background:#fff;border:1px solid #E3E7EE;border-radius:12px;padding:16px 18px;margin:14px 0';
  const h2 = 'font-size:17px;margin:0 0 10px;color:#1F2A44';
  const td = 'padding:8px 6px;border-top:1px solid #EEF1F5;vertical-align:top;font-size:14px';
  const th = 'padding:6px;text-align:left;font-size:12px;color:#6B7280;font-weight:600';
  const pill = (t, warn) => `<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;background:${warn ? '#FDECEC' : '#EEF1F5'};color:${warn ? '#B42318' : '#374151'}">${esc(t)}</span>`;
  const weeksTxt = (ws, cur) => ws.map(w => `<span style="white-space:nowrap">${w === cur ? `<b>${esc(weekName(w, lang))}</b>` : esc(weekName(w, lang))}</span>`).join(', ');
  let h = `<div style="background:#F5F7FA;padding:20px 12px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111827;line-height:1.55">
  <div style="max-width:640px;margin:0 auto">
  <div style="font-size:13px;color:#6B7280">TLC ${T('셀 케어', 'Cell Care')}</div>
  <h1 style="font-size:21px;margin:4px 0 2px">${esc(title)}</h1>
  <div style="font-size:13px;color:#6B7280">${T('금요일 밤 기준 · 미제출은 ' + weekName(D.from, 'ko') + '부터 누적', 'As of Friday night · missing reports counted since ' + weekName(D.from, 'en'))}</div>
  <div style="${box}"><div style="${h2}">${T('한눈에', 'At a glance')}</div>
    <table style="width:100%;border-collapse:collapse;text-align:center"><tr>
      <td style="padding:6px"><div style="font-size:22px;font-weight:700">${subOk} / ${D.cells_due}</div><div style="font-size:12px;color:#6B7280">${T('셀보고서 제출', 'Cell reports in')}</div></td>
      <td style="padding:6px"><div style="font-size:22px;font-weight:700;color:${D.missing_cells.length ? '#B42318' : '#111827'}">${D.missing_cells.length}</div><div style="font-size:12px;color:#6B7280">${T('미제출 셀 (누적)', 'Cells missing (total)')}</div></td>
      <td style="padding:6px"><div style="font-size:22px;font-weight:700">${D.lr_done} / ${D.lr_total}</div><div style="font-size:12px;color:#6B7280">${T('교역자 보고', 'Leadership reports')}</div></td>
    </tr></table>
    ${D.cells_total > D.cells_due ? `<div style="font-size:12px;color:#6B7280;margin-top:6px">${T('토요일에 모이는 셀 ' + (D.cells_total - D.cells_due) + '곳은 다음 주 금요일이 마감이라 이번 주 집계에서 빠졌습니다.', (D.cells_total - D.cells_due) + ' Saturday cell(s) are due next Friday and are not counted yet.')}</div>` : ''}</div>`;

  // 요약
  if (S && S[lang] && ((S[lang].highlights || []).length || (S[lang].cells || []).length)) {
    const s = S[lang];
    h += `<div style="${box}"><div style="${h2}">${T('이번 주 중요 내용', 'This week’s key points')}</div>
      ${(s.highlights || []).length ? '<ul style="margin:0 0 8px;padding-left:20px">' + s.highlights.map(x => `<li style="margin:3px 0">${esc(x)}</li>`).join('') + '</ul>' : ''}
      ${(s.cells || []).map(c => `<div style="margin-top:12px"><b>${esc(c.cell)}</b><ul style="margin:4px 0 0;padding-left:20px">${(c.points || []).map(p => `<li style="margin:2px 0;font-size:14px">${esc(p)}</li>`).join('')}</ul></div>`).join('')}
      <div style="font-size:12px;color:#6B7280;margin-top:10px">${T('AI가 셀보고서를 바탕으로 정리한 요약입니다. 자세한 내용은 앱에서 확인해 주세요.', 'AI summary based on the cell reports. Please see the app for details.')}</div></div>`;
  } else if (D.reports.length) {
    h += `<div style="${box}"><div style="${h2}">${T('이번 주 중요 내용', 'This week’s key points')}</div><div style="font-size:14px;color:#6B7280">${T('이번에는 요약을 만들지 못했습니다. 앱에서 보고서를 확인해 주세요.', 'The summary could not be prepared this time. Please check the reports in the app.')}</div></div>`;
  }

  // 셀보고서 미제출
  h += `<div style="${box}"><div style="${h2}">${T('셀보고서 미제출', 'Cell reports not submitted')} ${pill(D.missing_cells.length + T('곳', ''), D.missing_cells.length)}</div>`;
  if (!D.missing_cells.length) h += `<div style="font-size:14px">${T('모든 셀이 보고서를 냈습니다. 🙏', 'Every cell has submitted. 🙏')}</div>`;
  else {
    const byCampus = {};
    D.missing_cells.forEach(x => { (byCampus[x.campus] = byCampus[x.campus] || []).push(x); });
    for (const [camp, list] of Object.entries(byCampus).sort((a, b) => a[0] === '분당' ? -1 : 1)) {
      h += `<div style="font-size:13px;font-weight:600;margin:10px 0 2px;color:#374151">${esc(CAMPUS[lang][camp] || camp)}</div>
      <table style="width:100%;border-collapse:collapse"><tr><th style="${th}">${T('셀', 'Cell')}</th><th style="${th}">${T('셀리더 / 담당', 'Leader / Leadership')}</th><th style="${th}">${T('안 낸 주', 'Missing weeks')}</th></tr>` +
      list.map(x => `<tr><td style="${td}"><b>${esc(x.cell)}</b></td><td style="${td}">${esc(x.leaders || '-')}<br><span style="color:#6B7280;font-size:12px">${esc(x.resp || '')}</span></td>
        <td style="${td}">${weeksTxt(x.weeks, D.week)}<br>${x.count > 1 ? pill(T('누적 ' + x.count + '회', x.count + ' total'), true) : ''}</td></tr>`).join('') + '</table>';
    }
  }
  h += '</div>';

  // 교역자 보고 미제출
  h += `<div style="${box}"><div style="${h2}">${T('교역자 보고 미제출', 'Leadership reports not submitted')} ${pill(D.missing_lr.length + T('분', ''), D.missing_lr.length)}</div>`;
  h += !D.missing_lr.length ? `<div style="font-size:14px">${T('모든 분이 교역자 보고를 내셨습니다.', 'All Leadership reports are in.')}</div>`
    : `<table style="width:100%;border-collapse:collapse"><tr><th style="${th}">${T('이름', 'Name')}</th><th style="${th}">${T('안 낸 주', 'Missing weeks')}</th></tr>` +
      D.missing_lr.map(x => `<tr><td style="${td}"><b>${esc(x.name)}</b></td><td style="${td}">${weeksTxt(x.weeks, D.week)} ${x.count > 1 ? pill(T('누적 ' + x.count + '회', x.count + ' total'), true) : ''}</td></tr>`).join('') + '</table>';
  h += '</div>';

  h += `<div style="text-align:center;margin:22px 0 8px"><a href="${APP_URL}" style="display:inline-block;background:#1F2A44;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">${T('셀 케어 열기', 'Open Cell Care')}</a></div>
  <div style="text-align:center;font-size:12px;color:#9CA3AF">${T('이 메일은 매주 금요일 밤 자동으로 보내집니다. 굵은 글씨는 이번 주입니다.', 'Sent automatically every Friday night. Bold = this week.')}</div>
  </div></div>`;
  return { subject: title, html: h };
}

async function sendMail(to, subject, html) {
  const user = (process.env.GMAIL_USER || '').trim(), pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) return { skipped: 'mail not configured (GMAIL_USER / GMAIL_APP_PASSWORD)' };
  const nodemailer = require('nodemailer');
  const tx = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  await tx.sendMail({ from: { name: 'TLC 셀 케어', address: user }, to, subject, html });
  return { sent: to };
}

async function build(week) {
  const D = await serviceRpc('weekly_digest', { p_week: week });
  D.recipients = await serviceRpc('digest_recipients', {}).catch(() => D.recipients || []);
  const S = await summarize(D.reports || []);
  return { D, S };
}

module.exports = async (req, res) => {
  try {
    // 앱에서: 미리보기 / 테스트 발송
    if (req.method === 'POST') {
      const user = await authUser(req);
      if (!user || !user.id) return res.status(401).json({ error: 'login required' });
      const ok = await fetch(SUPABASE_URL + '/rest/v1/rpc/can_preview_digest', { method: 'POST', headers: { apikey: PUBLISHABLE, Authorization: req.headers.authorization, 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json()).catch(() => false);
      if (ok !== true) return res.status(403).json({ error: 'not allowed' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { D, S } = await build(seoulToday().iso);
      if (body.test) {
        const both = [buildHtml(D, S, 'ko'), buildHtml(D, S, 'en')];
        const r = await sendMail(user.email, '[테스트] ' + both[0].subject, both[0].html + both[1].html);
        return res.status(200).json(r);
      }
      const out = buildHtml(D, S, body.preview === 'en' ? 'en' : 'ko');
      return res.status(200).json({ ...out, mail_ready: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD), summary: !!S });
    }
    // 금요일 밤 Cron
    if ((req.headers.authorization || '') !== 'Bearer ' + env('CRON_SECRET')) return res.status(401).json({ error: 'unauthorized' });
    const t = seoulToday();
    if (t.dow !== 5) return res.status(200).json({ skipped: '금요일에만 보냅니다', today: t.iso });
    const { D, S } = await build(t.iso);
    // 구글 시트용으로 요약을 저장 (메일 연결 전에도)
    if (S) await serviceRpc('digest_save', { p_week: t.iso, p_summary: S }).catch(() => {});
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return res.status(200).json({ saved: !!S, skipped: 'mail not configured' });
    const results = [];
    const en = buildHtml(D, S, 'en'), ko = buildHtml(D, S, 'ko');
    const enTo = [...new Set([...(D.recipients || []).filter(r => r.lang === 'en').map(r => r.email), ...(process.env.DIGEST_EN_TO || '').split(',')].map(s => String(s || '').trim().toLowerCase()).filter(Boolean))];
    if (enTo.length) results.push(await sendMail(enTo.join(','), en.subject, en.html).catch(e => ({ error: String(e.message || e) })));
    const koTo = [...new Set([...(D.recipients || []).filter(r => r.lang === 'ko').map(r => r.email), ...(process.env.DIGEST_KO_TO || '').split(',')].map(s => String(s || '').trim().toLowerCase()).filter(Boolean))];
    if (koTo.length) results.push(await sendMail(koTo.join(','), ko.subject, ko.html).catch(e => ({ error: String(e.message || e) })));
    res.status(200).json({ today: t.iso, summary: !!S, results });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
