# 주간 이메일·번역 변경 기록

## 확인한 현재 구조 (2026-10-16)

- 저장소: https://github.com/tlc-sites/cell-care, 기준 커밋 `f2d082a44ac359c3b5be65634d42615f90af72d0`.
- Vercel 운영 도메인 https://tlc-cell-care.vercel.app/ → `darren-from-tlc/tlc-cell-care`, `main` 자동 배포. 대시보드에서 운영 도메인·커밋을 대조함.
- 같은 저장소에 `cell-care` Vercel 프로젝트도 연결되어 GitHub에 두 배포 상태가 올라옴. 이메일 활성화는 목표 프로젝트 한 곳에서만 해야 함.
- 화면: 단일 `index.html`, 서버: CommonJS Vercel 함수, 데이터·로그인: 서울 Supabase `mcbbhsvvzqvtrxlbdcks`.
- 기존 금요일 17시(KST) `cron-senior`는 푸시만 발송. 이메일/Gmail 서버 연동은 없었음. Google Sheets 내보내기는 목사님께 드리는 말씀·교역자 보고·성도 동정을 의도적으로 제외하므로 이메일 데이터 소스로 재사용하지 않음.
- 운영 환경 변수 **이름만** 확인: `ANTHROPIC_API_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`. 값은 열거나 복사하지 않음. OpenAI/Gmail 값은 아직 없음.
- Supabase에서는 함수 정의·테이블 열 정보·RLS 정책만 조회. 운영 목양 내용, 로그인 비밀 값은 추출하지 않음. 이 작업에서 운영 DB 스키마나 데이터를 바꾸지 않음.

## 확인 메모의 실제 권한

한글 명칭과 역할 안내는 기준 커밋에 이미 반영되어 있었음. 이번에는 영어에 사모님을 명시하고, 확인 기록에서 메모에 제목을 붙이고 영어 번역을 연결함.

`leadership_reviews`의 RLS 활성화 확인. SELECT 정책은 `private.can_oversee_report(report_id)`.

- 제출 이력이 있는 보고서에만 적용.
- 현재/해당 주 셀리더인 사람은 확인 기록을 읽지 못함. 목사님·사모님 역할이 겹쳐도 이 제한은 유지됨.
- 그 외 목사님·사모님, 해당 셀의 현재 담당 분파셀리더, 보고서에 지정된 확인 담당자(leadership 역할 필요)가 읽을 수 있음.
- `review_report`는 `private.is_reviewer_of_report`를 검사하고 제출·확인 대기 상태에서만 저장함.
- 이메일과 번역에서도 이 기존 읽기 규칙을 그대로 사용. 일반 셀리더·다른 분파셀리더·관리자에게 노출을 확대하지 않음.

## 변경 내용과 영향

1. `api/translate.js` 공유 번역 함수를 OpenAI Responses API로 교체. 기본 모델 `gpt-4.1-mini`, 별도 `OPENAI_TRANSLATE_MODEL`로 변경 가능. 모델별 비용·품질의 실제 평가는 키 설정 후 진행해야 함. 기존 필드 키와 번역 요청 형태, 한국어 원문 표시, 한국어/영어 방향은 유지. 누락·잘린 결과·거절은 성공으로 처리하지 않음. `store:false`, 제한 시간, 제공자 오류 내용 비노출 적용. 이름은 그대로 보존하도록 지시하지만 실제 번역 품질 확인은 별도 필요.
2. 목사님께 드리는 말씀의 자동 영어 번역과 목사님·사모님 댓글의 한국어 번역도 같은 OpenAI 함수를 사용. 키 설정 전에 이 변경을 운영에 배포하면 번역이 작동하지 않으므로 **키 준비 전 main 병합 금지**.
3. 이메일: 한눈에 보기 → 목사님께 드리는 말씀 → 확인 필요한 것 → 교역자 보고 → 성도 동정 → 담당별 셀보고서. 본문·기도제목·확인 메모는 전체 포함하고 출석은 인원수만 표시. 영어 메일에는 한글 원문도 함께 표시. 두 수신자에게 별도 메일로 발송하며 CC/BCC 사용 안 함.
4. 목사님은 영어, 사모님은 설정된 ko/en 사용. 사모님이 앱 언어를 바꾸면 `weekly_email_set_language`로 저장(등록된 수신자 설정만 업데이트, 자동 수신 등록 안 함). 현재 앱 언어는 기기 로컬 저장이므로 최초 등록 때 현재 언어를 설정해야 함.
5. `/api/cron-weekly-email`을 별도 예약 요청으로 추가. 내부 rewrite로 기존 `cron-senior?delivery=email`에 연결하여 서버 함수 개수는 늘리지 않음. 기본 `cron-senior` 푸시 처리와 실행 요청은 분리됨. 기존 푸시 예약 시각과 대상은 유지.
6. SQL은 수신자 설정·발송 이력 테이블과 서비스 전용 RPC만 추가. 기존 테이블·권한은 바꾸지 않음. 수신자는 활성 프로필·현재 senior 역할·이메일 인증·개별 수신 등록을 모두 검사하고 로그인 계정의 인증된 이메일로 발송. 다른 수신 주소 지원은 현재 범위에 포함하지 않음.
7. 발송 예약 중복은 DB의 `(week_start,auth_user_id)` 유일 조건으로 제어. 메일 본문은 DB 발송 이력에 저장하지 않음. `preparing`에서 실패하면 재시도 가능, Gmail 요청 후 결과를 확신할 수 없으면 `uncertain`으로 멈춤. 프로세스가 중단되어 남은 `sending`도 자동 재발송 안 함.

## 검증과 아직 하지 않은 것

- `npm test`: 번역 응답 형식/오류, 영어↔한국어 공유 함수, HTML 이스케이프·본문 누락, MIME, 주차, 예약 인증·시각·비활성화, Gmail 성공·불명확한 실패, 중복 차단 검증.
- 로컬 PostgreSQL(PGlite)에서 실제 migration 실행. 기존 DB 계약을 모사한 가상 데이터로 수신 역할·비활성 계정·작성 중 보고 제외·확인 메모 권한·상태 전이·일반 사용자 RPC 차단 검증.
- `npm run preview:email`: 가상 기록과 사람이 작성한 예시 번역으로 ko/en HTML 생성. 브라우저 데스크톱 및 390px 너비 확인. Gmail/Outlook 등 실제 메일 클라이언트 표시 확인은 아직 안 함.
- 운영 DB migration, 실제 OpenAI 호출·품질 평가, Gmail OAuth 연결·실제 발송, 운영 배포는 아직 안 함. 사용자가 키/발신 계정 설정을 나중에 하기로 함.
- 저장소에 테스트한 SQL이 포함되지만, 운영 적용 전에는 동일한 migration을 staging DB에서 검증하고 기존 함수 계약과 대조해야 함.

## 나중에 활성화할 순서

1. `tlc-cell-care` Vercel Production에 `.env.example`의 OpenAI/Gmail 값을 직접 설정. 비밀 값은 저장소·채팅에 넣지 않음. Gmail OAuth는 교회 발신 계정으로 승인하며 `gmail.send` 범위와 갱신 토큰을 사용. `WEEKLY_EMAIL_FROM`은 승인된 계정/허용된 발신 별칭이어야 함. Google Cloud OAuth 앱·Gmail API 활성화와 운영용 동의 설정이 필요함.
2. `WEEKLY_EMAIL_ENABLED=false` 유지. staging에서 `db/weekly-email.sql` 검증 후 운영에 적용. 이 migration은 자동 실행되지 않음. 등록 행이 없으므로 적용만으로 메일이 발송되지 않음.
3. 활성 senior 프로필에 연결된 `auth.users`를 확인하고 `weekly_email_settings`에 두 수신자를 명시적으로 등록. 처음에는 `enabled=false`; 사모님 언어도 현재 앱 설정에 맞춤. 목사님 언어는 서버가 en으로 강제.
4. OpenAI로 가상 기록을 번역하고 이름·문장·의미, 댓글의 한국어 번역을 확인. 발신 Gmail로 가상 기록만 보내 실제 메일 표시를 확인. 운영 목양 내용으로 테스트 발송하지 않음.
5. 준비된 변경을 병합·배포하고 기존 로그인/보고 작성·확인·댓글·푸시 경로를 확인. 필요한 실제 발송 승인을 받은 뒤 수신자 `enabled=true`와 목표 Vercel 프로젝트의 `WEEKLY_EMAIL_ENABLED=true`를 설정하고 다시 배포.
6. 다른 Vercel `cell-care` 프로젝트는 이메일 비활성화 유지. cron은 UTC `0 8 * * 5`(금요일 17시 KST). Vercel Hobby의 예약 시각 정밀도는 시간 단위이므로 정확한 17:00 도착을 보장하지 않음. 분 단위 정시 실행이 필요하면 스케줄러/플랜을 별도로 결정해야 함.

## 운영 중 실패 처리와 되돌리기

- `failed`: 사전 준비 실패. 설정을 고치고 같은 금요일 17시대에 인증된 cron을 다시 요청할 수 있음. 이미 `sent`인 수신자는 건너뜀.
- `sending`/`uncertain`: 저장된 Message-ID와 발신 Gmail의 보낸편지함을 운영자가 대조. 실제 발송 여부를 확인하기 전 상태를 `failed`로 바꾸지 않음. 자동 재시도로 중복 전달을 만들지 않도록 의도적으로 중단하는 방식이며 exactly-once 보장을 주장하지 않음.
- 이메일 중지: `WEEKLY_EMAIL_ENABLED=false`로 설정 후 재배포. 수신자 설정을 비활성화해도 됨. 기존 푸시에는 영향 없음.
- 번역 되돌리기: 이 PR의 번역 관련 파일을 이전 커밋으로 복원하고 기존 Anthropic 환경 변수로 재배포. 새 OpenAI API 코드에 Anthropic 키를 넣지 않음. 이전 번역문이나 기존 보고 데이터는 삭제하지 않음.

공식 참고: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [Gmail 전송 형식](https://developers.google.com/workspace/gmail/api/guides/sending), [Vercel rewrite](https://vercel.com/docs/routing/rewrites), [Vercel Cron 요금제](https://vercel.com/docs/cron-jobs/usage-and-pricing).
