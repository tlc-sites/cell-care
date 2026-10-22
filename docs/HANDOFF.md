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
- 그 뒤로는 `supabase/migrations/`에 날짜 이름으로 추가(Codex 방식). 지금 있는 것: `20261021010000_notifications_replies.sql`.
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

## 7. 남은 일

- 블루웹 DNS: MX·SPF(`v=spf1 include:_spf.google.com ~all`)·DKIM → 교회 메일 받기, 스팸함 방지
- 개인 Gmail 앱 비밀번호 삭제, office@ 계정 복구 수단 추가
- 모임 시간·장소, 대신 쓴 표시, 공지는 아직 구글 시트에 없음
- 처음 금요일 실행(10/23) 뒤 Vercel Logs와 `weekly_digests` 확인
