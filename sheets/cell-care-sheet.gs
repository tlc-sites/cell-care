/**
 * 셀 케어 → 구글 시트 자동 정리 (Google Apps Script)
 *
 * 하는 일: 매주 토요일 새벽(금요일 밤 주간 요약 메일 다음), 이번 주와 지난주의
 *   ① 주간 요약  ② 셀별 중요 내용  ③ 미제출 누적
 *   ④ 셀보고서 현황  ⑤ 출석  ⑥ 셀 케어  ⑦ 기도제목
 *   ⑧ 성도 동정(모두 공개)  ⑨ 교역자 보고  ⑩ 확인 기록  ⑪ 코멘트
 *   ⑫ 특수 보고 기록 — 받는 사람을 정해서 남긴 것(담임목사님께 드리는 말씀, 지정 공개 성도 동정, 메시지)은
 *      누가·언제·누구에게만 남고 내용은 남지 않습니다
 * 을 각 탭에 정리합니다. 같은 주차는 지우고 다시 써서, 고친 내용도 최신으로 맞춰집니다.
 *
 * 처음 한 번만:
 *   1) 프로젝트 설정(톱니바퀴) → 시간대를 "(GMT+09:00) 서울"로
 *   2) 프로젝트 설정 → 스크립트 속성 → 속성 EXPORT_TOKEN, 값은 Vercel에 넣은 것과 같은 값
 *   3) 위쪽에서 함수 「처음설정」을 고르고 ▶ 실행 → 권한 허용
 */
const APP_URL = 'https://tlc-cell-care.vercel.app/api/export-week';
const FIRST_WEEK = '2026-09-28';   // 처음 설정할 때 이 주부터 지금까지 한 번에 채움

const TABS = {
  summary:    { name: '주간 요약',     wrap: true, src: ['digest', 'summary'], cols: ['주차', '셀보고서 제출', '셀보고서 미제출', '교역자 보고', '교역자 보고 미제출', '이번 주 중요 내용'] },
  cells:      { name: '셀별 중요 내용', wrap: true, src: ['digest', 'cells'],   cols: ['주차', '셀', '중요 내용'] },
  missing:    { name: '미제출 누적',    src: ['digest', 'missing'], cols: ['주차', '구분', '셀', '이름', '담당', '안 낸 주', '누적 횟수'] },
  reports:    { name: '셀보고서 현황', cols: ['주차', '캠퍼스', '분파리더', '셀', '셀리더', '상태', '제출 시각', '마감 후', '확인', '확인한 분', '모임', '모임 날짜', '못한 이유', '참석', '결석', '은혜와 나눔', 'Leadership에게'] },
  attendance: { name: '출석',         cols: ['주차', '분파리더', '셀', '이름', '구분', '출석', '결석 사유'] },
  care:       { name: '셀 케어',      cols: ['주차', '분파리더', '셀', '이름', '이슈 구분', '내용', 'Leadership 확인 필요', '관계 상대', '관계', '개인 기도제목'] },
  prayers:    { name: '기도제목',     cols: ['주차', '분파리더', '셀', '이름', '구분', '기도제목', '이번 주 소식'] },
  notes:      { name: '성도 동정',     wrap: true, cols: ['주차', '날짜', '캠퍼스', '쓴 분', '성도', '방법', '유형', '내용', '기도제목', '목사님 확인 필요', '목사님 확인', '사모님 확인'] },
  lr:         { name: '교역자 보고',   wrap: true, cols: ['주차', '교역자', '구분', '이름', '소속', '유형', '내용'] },
  reviews:    { name: '확인 기록',     wrap: true, cols: ['주차', '셀', '확인한 분', '제출 차수', '상위 보고', '확인 메모', '확인 시각', '고친 시각'] },
  comments:   { name: '코멘트',        wrap: true, cols: ['주차', '대상', '셀 또는 성도', '쓴 분', '내용', '한국어 번역', '시각'] },
  special:    { name: '특수 보고 기록', cols: ['주차', '시각', '구분', '보낸 분', '받는 분', '관련'] }
};

/** 처음 한 번 실행 (코드를 바꾼 뒤에도 한 번 더): 매주 토요일 새벽 자동 실행 등록 + 9/28 주부터 지금까지 채우기 */
function 처음설정() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === '매주정리') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('매주정리').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(1).everyWeeks(1).create();
  var w = FIRST_WEEK, now = mondayOf_(new Date());
  while (w <= now) { syncWeek_(w); w = addDays_(w, 7); }
  SpreadsheetApp.getActive().toast('설정을 마쳤습니다. 매주 토요일 새벽 1~2시에 자동으로 정리됩니다.', '셀 케어', 8);
}

/** 매주 토요일 새벽 자동 실행 (지금 바로 정리하고 싶을 때 직접 실행해도 됩니다) */
function 매주정리() {
  var now = mondayOf_(new Date());
  syncWeek_(addDays_(now, -7));   // 지난주 (토요일 모임 셀은 이번 금요일이 마감)
  syncWeek_(now);                 // 이번 주
}

function syncWeek_(week) {
  var token = PropertiesService.getScriptProperties().getProperty('EXPORT_TOKEN');
  if (!token) throw new Error('스크립트 속성에 EXPORT_TOKEN을 넣어 주세요.');
  var res = UrlFetchApp.fetch(APP_URL + '?week=' + week, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('셀 케어에서 받지 못했습니다 (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  var data = JSON.parse(res.getContentText());
  Object.keys(TABS).forEach(function (key) {
    var t = TABS[key], rows = t.src ? ((data[t.src[0]] || {})[t.src[1]] || []) : (data[key] || []);
    writeTab_(t, week, rows);
  });
  SpreadsheetApp.getActive().toast(week + ' 주 정리 완료', '셀 케어', 3);
}

function writeTab_(tab, week, rows) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(tab.name) || ss.insertSheet(tab.name);
  var n = tab.cols.length;
  sh.getRange(1, 1, 1, n).setValues([tab.cols]).setFontWeight('bold').setBackground('#E6EBF3');
  sh.setFrozenRows(1);
  // 지금 있는 행 중 같은 주차는 빼고, 새로 받은 행을 더한 뒤 한 번에 다시 씀
  var last = sh.getLastRow();
  var keep = last > 1 ? sh.getRange(2, 1, last - 1, n).getDisplayValues().filter(function (r) { return r[0] !== week && r.join('') !== ''; }) : [];
  var fresh = rows.map(function (r) { return tab.cols.map(function (c) { var v = r[c]; return v === null || v === undefined ? '' : String(v); }); });
  var all = keep.concat(fresh);
  var idx = ['분파리더', '셀', '이름'].map(function (c) { return tab.cols.indexOf(c); }).filter(function (i) { return i >= 0; });
  all.sort(function (a, b) {
    if (a[0] !== b[0]) return a[0] < b[0] ? 1 : -1;            // 최근 주차가 위로
    for (var k = 0; k < idx.length; k++) { var c = a[idx[k]].localeCompare(b[idx[k]], 'ko'); if (c) return c; }
    return 0;
  });
  if (last > 1) sh.getRange(2, 1, last - 1, n).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, n).setNumberFormat('@').setValues(all);
  if (tab.wrap) { sh.getRange(1, 1, Math.max(all.length, 1) + 1, n).setWrap(true).setVerticalAlignment('top'); for (var i = 2; i <= n; i++) sh.setColumnWidth(i, 280); }
}

function mondayOf_(d) {
  var s = Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
  var x = new Date(s + 'T00:00:00Z'); var dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow); return x.toISOString().slice(0, 10);
}
function addDays_(iso, n) { var x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
