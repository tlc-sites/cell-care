# 셀 케어 인수인계 (VS Code로 옮기기)

Claude(웹) 세션에서 2026-10-14 ~ 10-21에 만든 부분의 정리입니다. 교인 정보·비밀 값은 이 문서에 없습니다.
(이 저장소는 공개 저장소입니다. 교인 이름·연락처·비밀 키는 절대 커밋하지 않습니다.)

## 1. 구성

| 부분 | 위치 | 설명 |
|---|---|---|
| 화면 | `index.html` | 앱 전체(CSS·JS 포함) 한 파일. Supabase JS로 로그인·RPC 호출 |
| 안내 페이지 | `guide.html`(셀리더), `staff-guide.html`(교역자) | 「업데이트 소식」 + NEW 표시(30일 뒤 자동으로 숨김) |
| 서버 기능 | `api/*.js` | Vercel 서버 함수. `_`로 시작하는 파일은 함수 개수에 안 들어가는 모듈 |
| 정해진 시간 작업 | `api/cron.js?job=reminder|review|senior|digest` | `vercel.json`의 crons (시간은 UTC) |
| 구글 시트 | `sheets/cell-care-sheet.gs` | 교회 드라이브 「TLC 셀 케어 기록」 시트의 Apps Script. 매주 토 01:00 |
| 데이터 | Supabase 프로젝트 `tlc-cellcare` | 모든 권한은 RLS + SECURITY DEFINER 함수가 정함 |

배포: `main`에 push → Vercel(tlc-cell-care, 개인 Hobby 계정)이 자동 배포. 주소 https://tlc-cell-care.vercel.app

## 2. 꼭 지킬 것

- **Vercel 무료 요금제는 서버 함수 12개까지.** 지금 10개(`ls api | grep -v '^_'`). 새 기능은 기존 함수에 `?job=` 또는 body 값으로 합치기. 예: 공지 알림은 `notify-note.js`의 `{ notice }`, 메시지 알림은 `/api/message` → `senior-comment?job=message`(rewrite).
- **DB를 먼저, 앱을 나중에** 배포. 앱이 새 RPC를 먼저 부르면 화면이 깨짐.
- DB 변경은 「여러 번 실행해도 안전」하게(`create or replace`, `if not exists`). 돌려주는 칸이 바뀌는 함수는 `drop function` 후 다시 만들고 `revoke/grant`를 다시 씀.
- 화면 문구는 존댓말·따뜻한 한국어, 모바일 우선, 글씨 크게. 목사님용 화면은 `tr('한국어','English')`로 영어도 함께.
- 기능을 바꾸면 안내 페이지 「업데이트 소식」에 날짜별로 적고 해당 본문에 `<span class="new" data-new="YYYY-MM-DD">NEW</span>`.
- 비밀 값(Vercel 환경 변수)은 화면·채팅·저장소에 쓰지 않음.

## 3. 환경 변수 (Vercel, 이름만)

`SUPABASE_SECRET_KEY`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ANTHROPIC_API_KEY`(주간 요약·번역),
`EXPORT_TOKEN`(구글 시트와 같은 값), `GMAIL_USER`, `GMAIL_APP_PASSWORD`(교회 office@ 계정 앱 비밀번호), `DIGEST_EN_TO`(담임 목사님 메일).
값을 바꾼 뒤에는 **다시 배포**해야 적용됨. 로그인 메일은 Supabase → Authentication → SMTP(같은 office@ 계정). SMTP 화면을 저장할 때 비밀번호 칸이 비면 로그인 메일이 모두 멈추니 꼭 다시 넣고 저장.

## 4. DB 변경 기록

- 2026-10-21까지 실제 DB에는 Claude가 만든 변경 **01 ~ 51번**이 순서대로 적용되어 있음.
  이 SQL 파일들은 일부에 교인·교역자 이름이 들어 있어 **공개 저장소에 넣지 않고** 관리자에게 따로 전달함(비공개 zip).
- 그 뒤로는 `supabase/migrations/`에 날짜 이름으로 추가(Codex 방식). 운영 적용된 것: `20261021010000_notifications_replies.sql`, `20261022000000_report_talk_and_note_names.sql`, `20261022010000_note_categories_moves_schedule.sql`. (교역자 보고 v4.33 `leadership_report_items.leader_id`는 다른 작업에서 SQL Editor로 적용됨)
- 함수의 「지금 실제 모습」은 파일보다 DB가 정답: `select pg_get_functiondef('public.save_report(uuid,jsonb,integer)'::regprocedure);`

### 최근 변경 요약 (38 ~ 51)
| 번호 | 내용 |
|---|---|
| 38 | 부산 캠퍼스(`cells.campus='부산'`, `staff_shared`: 교역자 모두가 담당) |
| 39 | 관리자가 잘못 승인한 이메일 바꾸기 `admin_change_email` |
| 40 | 셀리더 추가·빼기·대표, 담당 바꾸기, 셀 만들기·닫기, 사용 중지 |
| 41 | 주간 요약 데이터 `weekly_digest`, 메시지(`msg_threads/participants/posts`, `msg_*` RPC). 「보고서 함께 보내기」로 받은 분은 그 보고서 열람 가능 |
| 42–43 | 주간 요약 받는 분, 요약 저장(`weekly_digests`), 시트용 `export_week` 보강 |
| 44 | 관리자 「한 주 큰 그림」 `admin_overview` |
| 45 | 시트 더 남기기 `export_week_more`(지정 공개 자료는 「특수 보고 기록」에 내용 없이 기록만) |
| 46–47 | 셀원을 빼도 저장이 막히지 않게, 로그인 메일 실패 알림(`app_alerts`, `admin_alerts`) |
| 48 | `issue_reach`: 셀원 이슈에서 셀리더·담당 교역자 찾기(목사님·사모님 전용) |
| 49–50 | `issue_board`가 모든 유형(`categories`)과 캠퍼스(`campus`)를 돌려줌 |
| 51 | 대신 쓰기 `private.can_write_report`(셀리더 또는 담당 교역자), 표시 `private.report_writer_label` → 「셀리더(교역자)」, 보류 `cell_members.on_hold` + `member_hold`, 셀리더도 이번 주 넣은 셀원 삭제 `private.can_delete_member`, 모임 시간·장소(`cells.meet_day/time/place`, `weekly_reports.meeting_time/place`, `cell_set_schedule`, `cell_schedule`), 공지(`announcements`, `notice_*`) |

## 5. 권한의 큰 틀

- 역할: `user_roles.role` = `leadership`(교역자) / `senior_pastor` / `samonim` / `admin`. 셀리더는 `cell_leaders`(기간 있음).
- 보고서 읽기: `private.can_read_report` — 쓸 수 있는 분(셀리더·담당 교역자), 제출 뒤 담당 교역자·목사님·사모님, 메시지로 함께 받은 분.
- 보고서 쓰기·제출: `private.can_write_report`. 확인(검토)은 셀리더 본인이 아닌 담당 교역자.
- 셀 검토 방식 `review_mode`: `leadership`(담당 교역자 확인) / `senior_direct`(목사님·사모님 직접) / `none`.

## 6. 운영 일정

- 월 09:00 셀리더 격려, 목 22:00·금 10:00 미제출 셀리더 알림, 금 12:00 마감(토요일 모임 셀은 다음 주 금)
- 금 13:00 교역자 알림, 금 17:00 목사님·사모님 알림, 금 23:59 주간 요약 메일(office@ → 목사님 영어, 사모님 한국어)
- 토 01:00 구글 시트 정리

## 6-1. 7가지 개선 작업 (2026-10-22 작성, 2026-10-23 운영 반영 완료)

운영 반영(2026-10-23): DB에 `20261022000000_…` → `20261022010000_…` 적용(SQL Editor, 둘 다 Success) → 읽기 전용 확인(대화 테이블·이동 테이블 RLS 켜짐, 함수 권한 anon 막힘·내부 함수 authenticated 막힘, 동정 `categories` 빈 값 0건·첫 값 불일치 0건, `cell_set_schedule` 새 권한, 동정 알림 제목 이름 표시) → 커밋 `1fb00db` push → Vercel 「Deployment has completed」, 사이트 200.

용어: 분파셀리더 = 담당 교역자(`leadership` 역할, `leadership_assignments`). 새 테이블은 `report.cellcare_*`, 기존 public 함수는 넓히는 방향으로만 고친다(사용자 결정).

| # | 내용 | 상태 |
|---|---|---|
| 2 | 모임 못 함 → 출석 단계 건너뜀, 확인·읽기 화면 출석 칸 대체, 저장 시 명단 전원 `unknown`으로 보내 이전 참석·결석 지움 | 화면 완료 (`tests/meeting-not-held.test.mjs`) |
| 3 | 보고서별 「담당 교역자 · 셀리더 대화」 + 알림함·푸시(`api/senior-comment.js`의 `{ talk }`) | 마이그레이션 `20261022000000_report_talk_and_note_names.sql` + 화면 완료 (`tests/report-talk.test.mjs`) |
| 4 | 셀 이름 옆 「금 19:30」 표시, 설정은 담당 교역자·관리자·담임만(화면 + `public.cell_set_schedule` 권한) | 마이그레이션 `20261022010000_note_categories_moves_schedule.sql` + 화면 완료 |
| 5 | 알림함 성도 동정 제목 `[성도 동정] 이름`(기존 기록도 갱신), 푸시 제목에 이름 | `20261022000000_…` + `api/notify-note.js` |
| 6 | 「확인할 보고서」: 주차와 무관하게 제출됐고 내가 아직 확인 안 한 보고서, 최근 제출 순 (`reviewBacklog`, 기존 `get_week_status` 재사용) | 화면 완료 |
| 1 | 성도 동정 이슈 구분 다중 선택: `pastoral_notes.categories text[]` 추가(기존 행은 `[category]`로 채움, `category`는 첫 값 유지 → 시트·요약 등 기존 사용처 그대로). 저장은 `report.cellcare_pastoral_note_save`(기존 `pastoral_note_save` 호출), 읽기는 `report.cellcare_note_categories` | `20261022010000_…` + 화면 완료 |
| 7 | 셀 이동 관리(교역자 홈 「셀 이동 관리」, 셀원 관리의 「셀 이동 등록」): 등록 → 기존 셀 담당이 셀리더·셀원 연락 체크 → 「셀 이동 적용」 → 이력. 적용 로직은 `public.member_move`와 동일(옛 행 `left_at`, 새 셀 새 행, 진행 중 기도제목 이동) → 과거 보고서·출석은 옛 셀 그대로. 이력 테이블 `report.cellcare_member_moves`(삭제 없음, 취소도 기록) | `20261022010000_…` + 화면 완료. 셀원 관리의 즉시 「다른 셀로 옮기기」 버튼은 이동 등록으로 바꿈(`member_move` 함수 자체는 그대로) |

- 운영 DB 구조는 2026-10-22 SQL Editor에서 읽기 전용 SELECT로 확인(컬럼, `member_move`, `cell_set_schedule`, `pastoral_note_save`, `is_cell_leadership(p_cell, d default null)`, `check_member_dates`/`audit_admin_change` 트리거, `issue_board`의 동정 유형은 `array[category]`).
- 검증: `npm test` 21개 통과(PGlite 가상 자료, 운영 접속 없음). 화면 캡처는 저장소 밖 `outputs/cellcare-improve-20261022/`.
- 권한 요약: 이동 등록·연락 체크는 기존 셀 담당 교역자/관리자, 적용은 두 셀 담당/관리자, 취소는 기존 셀 담당/등록자/관리자, 목록은 두 셀 담당·관리자·담임·등록자.
- 운영 반영 순서(완료): DB에 `20261022000000_…` → `20261022010000_…` 순서로 적용 → 앱 배포. 임시 자기 배정 파일 3개는 별도 작업이라 함께 적용·커밋하지 않음. 안내 페이지 guide.html·staff-guide.html에 2026-10-22 「업데이트 소식」과 본문(NEW) 반영. 역할 표시는 「셀리더 / 담당 교역자」 유지(분파셀리더 표기 사용 안 함).

## 6-2. 고칠 곳 빨간색 표시 (2026-10-23 작성 · main push로 배포, DB 변경 없음)

계기: 셀리더가 5. 확인에서 제출하면 3. 셀 케어로 되돌아가기만 하고 이유를 몰랐음(내용은 적고 유형을 안 고른 기록이 원인. 규칙 자체는 그대로).

- 보고서 작성(`index.html`): `reportProblems()`가 단계·칸(`data-err` 키)·이유·「기록 N」을 모두 모음. `validateForSubmit()`은 첫 문제를 `[단계, '기록 N: 이유']`로 돌려줌(기존 테스트 호환, 순서는 앞 단계부터). 제출 검사에 걸리면 `E.showErrs` → `showReportErrs()`가 칸 빨간 테두리, 칸 아래 이유(`errSlot`), 기록 카드·단계 표시 빨간색, 위쪽 「고칠 곳 N곳」(`#errsum`). 입력할 때마다 다시 계산해 고친 칸은 바로 지움.
- 다른 입력 화면: `fieldError(칸, 이유)`가 토스트 + 빨간 테두리 + 칸 아래 이유, 그 칸을 입력·선택하면 `clearFieldError`로 지움. 코멘트·대화·수정 요청 사유·이슈 보내기·교역자 보고·성도 동정·공지·메시지·관리자 이메일/승인·셀 이동·셀원 추가/옮기기·셀/셀리더 만들기·담당 바꾸기·새 참석자에 적용.
- 문구(사용자 요청): 셀 케어 기록의 「기도제목만 적을 때는…」 안내 두 줄 삭제(유형은 「여러 개 선택」만), 내용 칸 안내 글 「셀에서 나눈 내용을 나눠 주세요」, 개인 기도제목 칸 안내 글 「셀원이 나눈 기도제목을 적어 주세요」.
- 안내 페이지: guide.html·staff-guide.html에 2026-10-23 「업데이트 소식」, staff-guide 「확인」 단계에 NEW.
- 검증: `npm test` 28개 통과(새 `tests/report-field-errors.test.mjs` 7개 포함). 화면 캡처는 가짜 자료·Chrome headless로 `outputs/cellcare-field-errors-20261023/`. 실제 로그인 화면·휴대폰에서는 아직 확인 안 함. DB 변경 없음.

## 6-3. 셀 이동을 모든 교역자에게 (2026-10-23 운영 반영: SQL Editor 적용 → 커밋 `44f5dd1` 배포)

사용자 결정: 교역자(`leadership`)와 관리자는 담당과 관계없이 모든 셀·셀원을 보고 고르며, 등록·목록·연락 체크·적용·취소를 모두 할 수 있다. 담임 목사님·사모님은 지금처럼 목록만 본다. 알림은 지금처럼 두 셀 담당 교역자에게.

- DB: `supabase/migrations/20261023000000_moves_all_staff.sql` — `report.cellcare_move_staff()`(활성 + leadership 또는 admin, authenticated 직접 호출 막음) 추가, `cellcare_move_options/create/list/contact/apply/cancel` 권한 검사만 바꿈(`create or replace`, 반환 칸 동일, 이동 방식 그대로). 셀리더(교역자 아님)는 여전히 불가. 취소는 교역자·관리자 또는 등록한 분.
- 화면: 셀 이동 등록이 「지금 셀(내가 맡은 셀이 위) → 셀원 → 이동할 셀」 순서. 안내 문구에서 「기존 셀 담당」 표현 정리. staff-guide 셀 이동 본문·업데이트 소식 수정.
- 검증: `npm test` 29개 통과(`tests/note-moves.test.mjs`에 새 마이그레이션 테스트 추가: 담당 없는 교역자가 모든 셀원 보기·등록·연락·적용, 다른 셀 담당이 취소, 셀리더 거부, 관리자 가능, 두 번 실행 안전). 캡처 `outputs/cellcare-moves-all-staff-20261023/`.
- 운영 반영 순서: SQL Editor에서 `20261023000000_moves_all_staff.sql` 실행 → 앱 push. (앱이 먼저 나가도 깨지지는 않지만 셀원 목록이 내 셀만 나옴)

## 6-4. 담임 목사님·사모님이 쓴 성도 동정의 「확인 전」 (2026-10-23 배포, DB 변경 없음)

- 문제: 사모님이 「목사님 확인 필요」로 올린 동정이 「담임 사모님 확인 전」으로 표시됨(본인 확인 기록이 따로 없어서).
- 수정: `noteSave()`에서 목사님·사모님이 확인 필요로 저장하면 기존 `pastoral_note_ack`를 함께 호출. 커밋 `2a1c72a`(6-3과 섞이지 않게 이 두 줄만 커밋), 운영 사이트에 반영 확인.
- 이미 올린 글은 사모님이 「확인했습니다」를 한 번 눌러야 정리됨. 실제 계정으로 동작 확인은 아직 안 함.

## 6-5. 담임 목사님·사모님 「확인했습니다」를 모든 곳에, 두 분 각자 (2026-10-23 운영 반영: SQL Editor 적용 → 커밋 `44f5dd1` 배포)

사용자 결정: 확인이 필요한 모든 곳에 잘 보이는 확인 버튼, 두 분이 각자 확인.

- DB: `supabase/migrations/20261023010000_senior_acks.sql` — `report.cellcare_senior_acks`(kind `report`/`pastor_msg`/`lr`, 대상 id, role, 시간; 두 분 각 한 줄) + `cellcare_senior_ack(kind,id)`(목사님·사모님만, 원본 읽기 권한 다시 검사, 다시 누르면 시간 갱신) + `cellcare_senior_acks(kind,ids)`(보고서는 읽을 수 있는 분, 말씀은 `can_see_senior_comment`, 교역자 보고는 교역자·담임·관리자). 기존 테이블·함수 변경 없음. 성도 동정은 기존 `pastoral_note_ack` 그대로.
- 화면(`index.html`): `seniorAckBox()` 큰 초록 버튼 + 두 분 상태. 보고서(직접 확인 셀, 또는 목양/긴급 상위 보고 — 셀리더에게는 상위 보고 상태 때문에 안 보임) 상단, 「담임 목사님께 드리는 말씀」 카드 안, 교역자 보고 상단. 다시 제출·다시 보낸 뒤에는 그 뒤의 확인만 셈. 직접 확인 셀은 상단 버튼이 `review_report`(확인 완료)도 함께 하고, 아래 「보고서를 확인했습니다」도 누른 분의 확인을 남김. 전체 현황 맨 위 「확인하실 것」(최근 4주 + 늦게 제출된 직접 확인 보고서, 내가 아직 확인 안 한 것만, 바로 확인 버튼). 셀원 이슈 보기의 성도 동정에도 확인 상태·버튼. 성도 동정 확인 버튼도 큰 버튼으로. 전체 현황의 「교역자 확인」 숫자에서 직접 확인 셀 제외.
- DB 적용 전에 앱이 먼저 나가면 확인 칸만 숨겨지고 「확인하실 것」은 직접 확인 셀 보고서만 보임.
- 검증: `npm test` 30개 통과(새 `tests/senior-acks.test.mjs`). 화면 미리보기(예시 데이터) 캡처는 scratchpad에서 확인. 셀원 이슈 화면의 동정 확인 버튼은 예시 데이터에 동정이 없어 캡처로 못 봄. 실제 계정 확인 안 함.
- 안내: staff-guide 2026-10-23 「업데이트 소식」, 성도 동정 본문 NEW.

## 7. 남은 일

- 블루웹 DNS: MX·SPF(`v=spf1 include:_spf.google.com ~all`)·DKIM → 교회 메일 받기, 스팸함 방지
- 개인 Gmail 앱 비밀번호 삭제, office@ 계정 복구 수단 추가
- 모임 시간·장소, 대신 쓴 표시, 공지는 아직 구글 시트에 없음
- 처음 금요일 실행(10/23) 뒤 Vercel Logs와 `weekly_digests` 확인
