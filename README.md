# 주님의교회 셀 케어

셀리더 → Leadership → 스캇 브래너 담임 목사님 / 성희 브래너 사모님 순서로 올라가는 주간 셀 케어 보고 웹앱입니다.

- 주소: https://tlc-sites.github.io/cell-care/
- 화면: `index.html` 한 파일 (CSS·JavaScript 포함)
- 데이터·로그인: Supabase 프로젝트 `tlc-cellcare` (Northeast Asia, Seoul)

## 보안

- 이 저장소에는 **공개해도 되는 값**(Supabase 주소, publishable 키)만 들어 있습니다.
- 누가 무엇을 볼 수 있는지는 화면이 아니라 **데이터베이스의 권한 규칙(RLS)과 서버 함수**가 정합니다.
- service_role / secret 키, 데이터베이스 비밀번호는 절대 이 저장소에 넣지 않습니다.
- 교인 정보는 이 저장소에 없고 Supabase에만 저장됩니다.

## 설계 문서

DB 구조와 권한 정책은 Claude 설계 문서 「TLC 셀 케어 웹앱 설계안」의 v4 탭을 기준으로 합니다.

## 알림 (Vercel)

- `api/` 폴더는 Vercel 서버 함수입니다. 매주 주일·월요일 저녁(한국 시간 20시대)에 아직 보고서를 내지 않은 셀리더에게 앱 푸시 알림을 보냅니다 (`vercel.json`의 crons).
- 비밀 값은 저장소에 없고 Vercel 환경 변수에만 있습니다: `SUPABASE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` (+ 공개 값 `VAPID_PUBLIC_KEY`).
- 키 만들기: 배포된 주소의 `setup-keys.html` (브라우저 안에서만 만들어짐).

## 주간 이메일 / OpenAI 번역 (설정 후 활성화)

주간 이메일·번역 변경 범위, 확인 메모의 실제 권한, 검증 결과와 운영 활성화 절차는 [변경 기록](docs/weekly-email-rollout.md)을 참고해 주세요. 이메일은 기본 비활성화이며 DB migration·Gmail 연결이 필요합니다. OpenAI 번역 코드를 운영에 배포하기 전에 `OPENAI_API_KEY`를 먼저 설정해야 합니다.

- 로컬 검증: `npm install`, `npm test`
- 가상 데이터 메일 미리보기: `npm run preview:email` → `test-output/weekly-email-ko.html`, `test-output/weekly-email-en.html`
