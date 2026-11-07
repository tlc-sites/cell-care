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
`EXPORT_TOKEN`(구글 시트와 같은 값), `GMAIL_USER`, `GMAIL_APP_PASSWORD`(교회 office@ 계정 앱 비밀번호), `DIGEST_EN_TO`(담임 목사님 메일),
`PASTORAL_ALERT_EMAILS`(목회적 케어 보고 메일 받는 분, 쉼표로 여러 주소 — 6-6, 아직 미등록).
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

## 6-6. 연속 미모임 목회적 케어 보고 · 보고서 열람 시 알림 읽음 · 알림 이름 표시 (2026-10-26 작성, 2026-10-29 운영 반영)

사용자 요청 3가지 + 메일. 세 상태는 테이블을 나눔: 보고서 열람 `report.cellcare_report_reads` / 일반 알림 읽음 `cellcare_notification_items.read_at` / 목회적 케어 확인 `cellcare_pastoral_alert_reads` (+ 해결 `cellcare_pastoral_alerts.status`, 메일 `cellcare_pastoral_alert_email_logs`).

- DB ① `supabase/migrations/20261026000000_notification_refs_report_reads.sql`: 알림 항목에 nullable `kind`(REPORT_SUBMITTED/REPORT_UPDATED)·`report_id`·`cell_id`·`author_id`·`cell_name`·`author_name`·`week_start` 추가, 넣을 때 트리거 `cellcare_notification_fill`이 `submit-<id>-<n>` 알림을 채움(기존 행도 채움). `cellcare_notification_list`는 칸이 늘어 drop 후 재생성(이름: 지금 정보 → 저장한 이름 → 「… 정보 없음」). `cellcare_report_open(p_report)`: 열람 기록 + 내 같은 보고서 제출 알림만 읽음. 먼저 읽고 나중에 생긴 알림은 처음부터 읽음(다시 제출된 것은 제외).
- DB ② `supabase/migrations/20261026010000_pastoral_alerts.sql`(senior_acks 먼저 필요): `cellcare_consecutive_missed_meetings`(제출된 보고서끼리 연속 `meeting_held=false` 주 수, 미제출 주는 세지 않고 `gap_weeks`로; 미제출 주 수는 마감(금 12:00, 토·일 모임 셀 다음 주 금) 지난 주 기준), `cellcare_pastoral_evaluate(p_dry)`(생성/긴급 상향 시 다시 OPEN/갱신/해결 MEETING_HELD·STREAK_BROKEN·CELL_CLOSED, 셀당 열린 경고 하나는 unique index), 메일 `email_due`(단계마다 한 번, 단계 정해진 지 14일 지나면 안 보냄)·`email_claim`(받는 분마다 자리 잡기, 실패 3번까지 재시도)·`email_result`, 화면 `cellcare_pastoral_board`(담임·관리자, 메일 기록은 관리자만), `cellcare_pastoral_alert_ack`(두 분 각자·단계마다).
- 서버: `api/_pastoral.js`(DB 판정 → 그 뒤 메일, 실패는 기록만, `?dryRun=1`), `api/cron.js`에 `job=pastoral`, `vercel.json` 크론 `30 4 * * *`(매일 13:30 KST). 함수 개수 그대로 10개. `api/_digest.js`의 `sendMail`에 text 인자·export 추가. `api/notify-submit.js` 이름·셀 이름이 비면 빈칸 대신 「셀리더님」「셀 정보 없음」.
- 화면: `notifications-ui.js` 제출 알림 문구를 이름·셀·주차로 다시 만듦(`notificationText`), `markReportOpened`. `index.html` 보고서 상세에서 `markReportOpened`, 담임 「전체 현황」 맨 위 `pastoralCareCard`(접힌 카드 → 긴급/목회적 확인 필요/보고 미제출/최근 해결), 관리자 홈 메일 실패 배너, 미리보기 예시 자료. staff-guide 2026-10-26 소식·본문 NEW. 용어는 「담당 교역자」 유지(메일 본문만 「담당 교역자(분파셀리더)」).
- 검증: `npm test` 40개 통과(새 `tests/pastoral-alerts.test.mjs`·`report-reads.test.mjs`·`pastoral-email.test.mjs`, 공용 `tests/_pastoral-db.mjs`, `notification-ui.test.mjs` 2개 추가). 캡처(예시 자료·Chrome headless): `outputs/cellcare-pastoral-alerts-20261026/`. 실제 DB·실제 메일·실기기는 확인 안 함.
- 운영 반영 순서(승인 후): SQL Editor에서 ① → ② 실행 → Vercel에 `PASTORAL_ALERT_EMAILS` 등록 → 앱 push → `GET /api/cron?job=pastoral&dryRun=1`(CRON_SECRET)로 첫 판정 미리 보기 → 다음 크론 또는 수동 1회 실행. 첫 실행 때 이미 2주 이상인 셀은 한꺼번에 경고·메일이 생김.

### 6-6 운영 사전 확인 (2026-10-28, 읽기 전용)
- SQL Editor 읽기 전용 확인: 필요한 칸 28개 모두 있음(`weekly_reports.meeting_held/meeting_date/submitted_at`, `cells.meet_day/created_at/active`, `cell_leaders.is_primary`, `leadership_assignments.leadership_user_id` 등), 함수 6개 있음, `cellcare_report_reads`·`cellcare_pastoral_alerts`는 아직 없음(=미적용 확인). 활성 셀 60개, 최근 6주 `meeting_held=false` 제출 보고서 14건 → 첫 실행 때 경고가 몇 건 생길 수 있음.
- **수정**: ①의 `cellcare_notification_list` 재생성 본문이 10/21 버전 기준이라 10/22에 넣은 「지운 보고서 대화(`talk-%`) 알림 숨김」이 빠져 있었음. 운영 본문 md5가 `20261022000000` 본문과 같음을 확인한 뒤 ①에 `talk-%` 조건을 다시 넣음. 테스트 DB에 `report.cellcare_report_talk` 추가, `tests/report-reads.test.mjs`에 회귀 테스트 추가 → `npm test` 41개 통과.
- 운영 DB 적용(①·②)·`PASTORAL_ALERT_EMAILS` 등록·push는 **아직 안 함**. 받는 메일 주소도 미정(비우면 화면 경고만).

### 6-6·6-7 운영 반영 (2026-10-29)
- SQL Editor에서 ① `20261026000000_…` → ② `20261026010000_…` 실행(사용자가 Run, 둘 다 Success). 읽기 전용 확인: 알림 새 칸 7개, `cellcare_report_reads` RLS, 채우기 트리거 1, 알림 목록에 talk/reply 숨김 유지, 기존 제출 알림 108/108 채움, 새 테이블 3개 RLS, `cellcare_pastoral_evaluate`는 service_role만, `cellcare_pastoral_board`는 authenticated만(anon 막힘). `cellcare_pastoral_evaluate(true)` 미리 판정: 지금 2주 이상 연속 미모임 셀 0곳.
- push 전에 원격에 다른 세션의 `9b12fa6`(알림함 업데이트 공지 20261025-1, node_modules 포함)이 있어 rebase. 충돌(`notifications-ui.js` 알림 목록, `staff-guide.html` 소식, 알림 테스트)은 둘 다 살림. 테스트 42개 통과 후 `a713a6e` push → 운영 사이트에 새 코드 확인(index 200, cron 인증 없이 401).
- `PASTORAL_ALERT_EMAILS`는 등록 안 함(메일 없이 화면 경고만). 업데이트 공지(APP_UPDATES)는 이번 변경이 교역자 화면뿐이라 새로 추가하지 않음. 실제 로그인 화면 확인은 아직 안 함.

## 6-7. 담임 목사님·사모님 확인 버튼을 글 아래로 (2026-10-28, 2026-10-29 배포, DB 변경 없음)
- 사용자 요청: 글을 다 읽으신 뒤 확인하시도록. `viewReportDetail`의 `seniorAckBox('report', …)`를 상단 상태 배너 밑 → 본문 카드(코멘트 포함) 뒤·교역자 「보고서 확인하기」 앞으로. `viewLrRead`의 `seniorAckBox('lr', …)`도 명단 뒤로. 말씀 카드·성도 동정은 원래 본문 아래라 그대로.
- 「전체 현황 → 확인하실 것」의 바로 확인 버튼은 그대로 둠(열지 않고 확인 가능 — 뺄지 사용자 결정 대기).
- staff-guide 「업데이트 소식」을 2026-10-28로 묶음(6-6 소식 포함, NEW 날짜도 10-28). 실제 화면 캡처는 안 함.

## 7. 남은 일

- 목회적 케어 메일 받는 분 정해서 Vercel `PASTORAL_ALERT_EMAILS` 등록 → 재배포. 첫 크론(매일 13:30) 뒤 Vercel Logs 확인.
- 「전체 현황 → 확인하실 것」의 바로 확인 버튼을 뺄지 결정.

- 번역 안 됨 신고(2026-10-23): 서버·키 설정은 살아 있음(가짜 토큰 시험). API 키를 다시 넣은 뒤 재배포 전이었을 가능성. 커밋 `6753dbe`로 재배포 + 실패 이유를 화면 괄호와 Vercel Logs(`translate failed:`)에 표시. 목사님 화면에서 다시 확인 필요.

- 블루웹 DNS: MX·SPF(`v=spf1 include:_spf.google.com ~all`)·DKIM → 교회 메일 받기, 스팸함 방지
- 개인 Gmail 앱 비밀번호 삭제, office@ 계정 복구 수단 추가
- 모임 시간·장소, 대신 쓴 표시, 공지는 아직 구글 시트에 없음
- 처음 금요일 실행(10/23) 뒤 Vercel Logs와 `weekly_digests` 확인

## 2026-11-03 확인받은 셀보고서도 셀리더가 다시 고치기
- 새 함수 `report.cellcare_reopen_report(uuid)`(마이그레이션 20261103000000). 운영 `public.reopen_report` 본문과 같되 확인(reviewed)된 보고서도 열고, 그때는 `review_status='pending'`·확인 표시를 지운다. 이전 확인자는 `report_events`의 'reopened' detail에 남긴다. public은 그대로.
- 다시 제출은 기존 `public.submit_report`가 「확인 대기」로 돌린다(운영 본문 확인).
- 화면: 보고서 상세의 「보고서 고치기」를 확인 여부와 상관없이 셀리더에게 보이고 새 함수를 부른다. 테스트 `tests/reopen-reviewed.test.mjs`.

## 2026-11-05 셀원 이슈 「내 분파」 · 확인한 보고서 알림 읽음 · 부산 셀 담당 정리

사용자 피드백(알림함·이슈보기·셀 이동 등 6가지) 가운데 먼저 처리한 것. 운영 DB는 읽기 전용으로 원인 확인 → SQL Editor 적용(사용자 Run, 둘 다 Success) → 읽기 전용 확인.

- DB ① `supabase/migrations/20261105000000_issue_scope_review_reads.sql`
  - 원인: 운영 `public.issue_board`는 「내 분파」에서도 볼 수 있는 성도 동정을 모두 넣음(동정에는 셀·셀원 연결 없이 `person_name`만 있음).
  - `report.cellcare_issue_board`: `issue_board`를 감싸 「내 분파」의 동정은 내가 쓴 것(`my_area`) + 이름(띄어쓰기 무시)이 내 담당 셀 셀원과 같은 것만. 앱은 `issue_board` 대신 이것을 부름(미리보기는 그대로).
  - 원인: 제출 알림은 상세 화면을 열 때만 읽음이 됨 → 「확인했습니다」만 누른 보고서 알림이 남음. 앱이 확인 뒤 `markReportOpened`를 부르고, 남은 알림은 「받은 분 본인이 그 알림 뒤에 확인(report_events 'reviewed')·「확인했습니다」」인 것만 한 번 정리(적용 시 안 읽은 제출 알림 101 → 61).
- DB ② `supabase/migrations/20261105010000_busan_staff.sql` (사용자 결정)
  - 남장년1 → 이흥배 목사, 여장년1·2 → 황성수 사모: `staff_shared=false` + `leadership_assignments`(2026-11-02부터).
  - 남장년2는 교역자 8분 모두가 셀리더인 셀(검토 없음)이라 담당을 둘 수 없음(`check_leadership_assignment`). 첫 적용이 이 오류로 통째로 되돌려졌고, 남장년2는 빼고 그대로 둠.
  - 청년1·2 → 두 분 공동: `staff_shared` 유지 + 새 표 `report.cellcare_shared_staff`(RLS, 직접 접근 막음). `leadership_assignments`는 제외 제약으로 한 셀·한 기간에 한 분만이라 공동은 이 표로만.
  - `private.is_cell_leadership`: 공동 셀 조건에 「목록이 있으면 목록에 있는 분만」 한 줄 추가(본문은 운영에서 읽음). 목록 없는 공동 셀은 예전처럼 교역자 모두. 다른 교역자는 지난 부산 보고서도 못 봄(사용자 확인).
  - `report.cellcare_shared_staff_list`(이름 표시), `cellcare_cell_staff`(공동 셀은 목록 이름), `cellcare_my_report_reads`(내가 연 보고서).
- 화면(`index.html`): 부산을 `campus === '부산'`으로 공동 처리하던 곳을 `isSharedRow`(부산 + 담당 없음)로 바꿈(대신 쓰기·대화·담당 표시·묶음). 교역자 홈에 「함께 맡은 셀 · 아직 안 보신 보고서」(최근 4주, 다른 분이 확인했고 내가 그 제출 뒤로 안 연 것). staff-guide 11/5 소식·본문 NEW.
- 남은 것: 청년 공동 셀은 제출 휴대폰 알림이 없음(전부터 공동 셀은 `submit_push_targets`가 배정 기준이라 안 감, 알림함에는 옴). 셀원 중복 6명 「같은 분으로 합치기」(5번), 셀별 보고서 모아 보기(6번), 알림함 카테고리(1번), 디자인 개편.

## 2026-11-05 화면 개편(PC·다크 모드) · 알림함 종류 · 성도 동정 쓴 분

교회 보고 앱(2026-11-05 개편)과 같은 틀. 남색 팔레트는 그대로. main push로 배포.

- PC(가로 900px 이상, 로그인 뒤 `body.has-side`): 왼쪽 사이드바(`#sidebar`, `renderSidebar()` — `renderTabs` 시작에서 그림: 탭·사용 안내·내 정보·밝기·언어·로그아웃), 위에 붙은 제목 줄, 본문 최대 880px, 촘촘한 버튼. 알림함 종(🔔)은 PC에서도 제목 줄 오른쪽(사용자 요청). 휴대폰 화면은 그대로.
- 다크 모드: 색은 모두 `:root` 변수(`--nav*`, `--field`, `--mine*`, `--toast-*` 등 추가). `:root[data-theme="dark"]` + `prefers-color-scheme`(`data-theme="light"`가 아니면). 고르기는 `localStorage` `cc-theme`(기기 설정/라이트/다크), `<head>` 스크립트가 그리기 전에 넣어 깜빡임 방지. 휴대폰은 첫 화면 맨 아래 `#appfoot`, PC는 사이드바 아래.
- `[hidden]{display:none!important}`: `.pill`의 display가 hidden을 이겨 알림 0개인데 「0」이 보이던 문제(운영에도 있던 것) 고침.
- 알림함 종류(`notifications-ui.js`): `notificationCategory(n)` — 알림 url로 셀보고서(`#report=`) / 코멘트·대화(`#report=…&comment|talk=`) / 메시지(`#thread=`) / 성도 동정(`#note=`) / 공지(`#notice=` + 앱 업데이트 공지) / 기타(셀 이동 `#section=` 등). 알림이 있는 종류만 칩으로, 안 읽은 수 표시. 종류를 고르면 「이 종류 모두 읽음」은 그 종류 알림만 하나씩 `cellcare_notification_read`. 미리보기(DEMO)에서는 예시 알림 7개(저장 안 됨).
- 성도 동정 쓴 분: 카드 위쪽 오른쪽에 굵게(아래 줄은 「보는 분」만), 알림 상세 「쓴 분: 이름」, 알림함 동정 알림에 「쓴 분 / 코멘트 쓴 분」.
  - 알림함 이름은 DB `supabase/migrations/20261106010000_note_notification_author.sql`(알림 목록 함수가 `note-`·`ncmt-` 알림에도 `author_name`을 돌려줌, 칸은 그대로) **운영 적용 전**. 적용 전에는 알림함만 예전처럼 이름 없이 보임(깨지지 않음).
- 안내 페이지 「업데이트 소식」 11월 5일에 추가. 안내 페이지 자체의 다크 모드는 아직 없음.
- 확인: `npm test` 50개 통과, 로컬 미리보기(데모)로 PC 라이트·다크·휴대폰 폭·로그인 화면·알림함 종류·동정 카드. 실제 계정 화면은 배포 뒤 확인 필요.
- 남은 것: 같은 분 합치기(브랜치 `feature/member-merge`, 6명 SQL은 저장소에 넣지 않고 SQL Editor로 — 사용자 Run 대기), 셀별 보고서 모아 보기, 청년 공동 셀 제출 휴대폰 알림.

## 2026-11-05 임시저장 버튼 · 작성 중 보고서 삭제

- 임시저장(배포 완료 `2aadefa`, DB 변경 없음): 쓰는 화면 아래 「이전 · 임시저장 · 다음」. `saveDraftAndLeave()` — 바뀐 것이 없어도 `save_report`로 한 번 저장한 뒤 `back()`. 실패·충돌이면 화면에 남고 이유 표시.
- 작성 중 보고서 삭제: DB `supabase/migrations/20261107000000_delete_draft_report.sql` — `report.cellcare_delete_draft_report(p_report)`(`private.can_write_report` + `status='draft'` + `submission_no=0`), 지운 보고서 줄은 `report.cellcare_deleted_reports`(RLS, 권한 없음 — 관리용)에 남김. 딸린 기록은 운영 외래 키 규칙대로 지워지고, 외래 키가 막으면 아무것도 지우지 않고 막은 테이블 이름을 알려 줌. 화면은 쓰는 화면 맨 아래 「이 작성 중 보고서 삭제」 → 확인 → 홈. **DB 먼저 적용, 그 뒤 앱 배포.**
- 운영 첫 삭제에서 `public.report_events` 외래 키가 막음 → `20261107010000_delete_draft_report_events.sql`: 그 보고서 이력을 `cellcare_deleted_reports.events`(jsonb)에 옮겨 담고 지운 뒤 보고서 삭제.
- 확인 못 한 것: 운영 `save_report`가 지난 기도제목 상태(계속/응답/종료)를 저장할 때 바로 바꾸는지(그렇다면 보고서를 지워도 그 변경은 남음).

## 2026-11-05 성도 동정 코멘트를 교역자도

- 운영 `public.note_comment_add`가 첫 줄에서 `is_senior()`만 허용하던 것을 `is_senior() or has_role('leadership')`로 넓힘(`supabase/migrations/20261107020000_note_comment_leadership.sql`, 나머지 본문은 운영과 같음 — 2026-11-05 운영에서 읽음). `can_read_pastoral_note` 조건은 그대로.
- 지우기·목록·푸시 함수는 쓴 분 기준이라 그대로. 푸시(`api/senior-comment.js`의 `note_comment`)는 동정 쓴 분께, 쓴 분이 목사님·사모님이면 푸시 없음(운영 `note_comment_push_targets` 그대로). 알림함은 그 동정을 볼 수 있는 분 모두.
- 화면: `noteComments()`의 코멘트 칸을 `isSenior() || hasRole('leadership')`에게. 번역 안내 문구는 목사님·사모님에게만.

## 2026-11-07 성도 동정 탭 새 글 표시

- 탭 이름 옆 빨간 숫자(`.tab-new`, `data-tab-new`): PC 사이드바는 이름 오른쪽, 휴대폰 아래 탭은 아이콘 오른쪽 위. `updateInboxBadge()`가 알림함 숫자와 함께 갱신한다.
- 숫자 = 안 읽은 「성도 동정」 종류 알림(`#note=` 공유·코멘트) 수(`tabNewCount`). 다른 탭은 아직 0(표시 없음). DB 변경 없음.
- 성도 동정 탭을 열면 알림함도 함께 불러오고, 그 알림의 동정 id를 `NOTE.fresh`에 담아 카드에 「N」을 보인 뒤 알림을 하나씩 읽음으로 바꾼다(`markNoteNotificationsSeen`). 「N」은 이번 로그인 동안 남고 로그아웃하면 지워진다.
