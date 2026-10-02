# Quickstart — Buildcare AI (컨테이너 없이 실행)

**Feature**: `001-buildcare-ai-platform` · **Plan**: [plan.md](./plan.md) · **운영 주소**: https://p3.sumzip.com

Docker 를 쓰지 않는다. 로컬·Homebrew DB 도 쓰지 않는다. 백엔드는 **원격 MariaDB**(research R3)에 접속한다.

---

## 1. 준비물

| 항목 | 요구 | 확인 |
|---|---|---|
| Node.js | 20 LTS 이상 (개발 장비 v25 에서 확인) | `node -v` |
| npm | 10 이상 | `npm -v` |
| 원격 MariaDB | 10.6 이상 — `mis.iptime.org:13306` / `ABC11pioneer3` (실측 12.1.2) | 비밀번호는 `Intent-Plan.md` `[데이터베이스 설정]` |
| pm2 | 운영 실행 시 | `pm2 -v` |
| Gemini API 키 | 실제 AI 분석 시에만 | 없으면 `AI_PROVIDER=mock` |

`mariadb`/`mysql` 클라이언트는 필요 없다. 스키마 적용은 Node 마이그레이션 러너가 한다(R4). Intent-Plan 의 `docker exec -it mariadb mysql …` 안내는 쓰지 않는다(Docker 금지, Homebrew `mysql` 금지) — 접속 확인은 `npm run db:check` 로 한다.

## 2. 설치

```bash
cd /Users/pioneer3/project261002
cd backend  && npm install && cd ..
cd frontend && npm install && cd ..
npx --prefix frontend playwright install chromium   # E2E 용 브라우저(1회)
```

## 3. 환경 변수 — `backend/.env`

`backend/.env.example` 을 복사해 값을 채운다. `.env` 는 커밋하지 않는다. 비밀번호는 이 파일에만 적는다.

```dotenv
NODE_ENV=development
PORT=9503                         # 운영(p3.sumzip.com → 192.168.0.19:9503). 로컬 개발만 할 때는 3000
APP_ORIGIN=https://p3.sumzip.com
JWT_SECRET=<32바이트 이상 무작위>
FILE_URL_SECRET=<32바이트 이상 무작위>
COOKIE_SECURE=1                   # HTTPS 전용 쿠키. http://localhost 개발만 할 때는 0

DB_HOST=mis.iptime.org            # 서버 내부 배포 시 192.168.0.91 / 3306
DB_PORT=13306
DB_USER=pioneer3
DB_PASSWORD=                      # Intent-Plan.md 값
DB_NAME=ABC11pioneer3
DB_NAME_TEST=ABC11pioneer3
ALLOW_TEST_ON_DEV_DB=1            # 계정에 DB 생성 권한이 없어 R20 모드 2(같은 DB + 표식 데이터)

AI_PROVIDER=mock                  # mock | gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
PAYMENT_PROVIDER=mock
BMS_PROVIDER=mock                 # mock | rest
MAIL_TRANSPORT=console            # console | smtp
STORAGE_DIR=./storage

SEED_DEMO_PASSWORD=<시연 계정 공통 비밀번호>   # 비우면 시드 실행 시 무작위 생성·1회 출력
SEED_ALLOW_RESET=1
AUTH_LOCK_MAX_FAILS=5
AUTH_LOCK_MINUTES=15
```

## 4. 데이터베이스 준비

```bash
cd backend
npm run db:check              # 접속·버전(>=10.6)·SHOW GRANTS·기존 객체 (마이그레이션 이력 없이 객체가 있으면 멈춤)
npm run db:migrate            # 001(설계 DDL 원본) → 002(앱 확장) → 003(RBAC 카탈로그). 재실행 안전
npm run db:seed:dev           # 시연 데이터 (이미 있으면 건너뜀)
npm run db:seed:dev -- --reset   # 업무 테이블을 비우고 다시 (SEED_ALLOW_RESET=1, NODE_ENV=production 이면 거부)
npm run db:seed:dev -- --only=us1,us3   # 특정 스토리만
```

적용 결과: 테이블 54(설계 40 + 확장 14) · 뷰 16 · 트리거 15 — `backend/docs/db-apply-log.md`.

### 시연 계정

비밀번호는 모두 `.env` 의 `SEED_DEMO_PASSWORD` 값이다(문서에 적지 않는다). 계정별 시연 동선은 [`backend/docs/seed-walkthrough.md`](../../backend/docs/seed-walkthrough.md).

| 이메일 | 역할 | 시연 대상 |
|---|---|---|
| (비회원) | — | US1 무료 체험 3회(기기 단위) |
| general@dev.local | 일반 사용자 | US1 결과 이력 · 체험 1회 남음 |
| general.empty@dev.local | 일반 사용자 | US2 체험 소진 → G2 → 이용권 구매 |
| general.expired@dev.local | 일반 사용자 | US2 만료 월 구독 → G2 |
| facility@dev.local | 시설관리자 | US3 현장 기록 · US4 추가 자료 요청 · US7 내 배정 점검 |
| facility.c@dev.local | 시설관리자 | RBAC 권한 요청 대기(건물 A) |
| building@dev.local | 건물관리자 | US5 건물 이력 · US7 정기점검 · US8 전문가 연결 |
| lead@dev.local | 시설관리자 + 건물관리자 | RBAC 다중 역할 메뉴 합집합 |
| enterprise@dev.local | 기업 관리자 | US6 우선순위 · 소속 조직 권한 부여 |
| enterprise.ss@dev.local | 기업 관리자 | US6 라이선스 만료 G0 |
| expert@dev.local | 전문가 | US4 검증 · US8 요청 수락 |
| expert.arch@dev.local | 전문가 | US8 거절 이력 |
| expert.busy@dev.local | 전문가 | US8 G8(가능일 없음) |
| operator@dev.local | 운영자 | RBAC 관리 · 기준값 · 고지 판본 |
| disabled@dev.local | 일반 사용자 | 비활성 계정 → 로그인 거부 |

## 5. 실행

### 로컬 개발

```bash
# backend/.env 에서 PORT=3000, COOKIE_SECURE=0 로 바꾼 뒤
cd backend && npm run dev     # http://localhost:3000 (배치 작업 포함, JOBS_ENABLED=0 으로 끔)
cd frontend && npm run dev    # http://localhost:5173 (/api · /files 는 3000 으로 프록시)
```

### 운영 (p3.sumzip.com)

```bash
cd backend  && npm run build          # dist/ + SQL 자산
cd ../frontend && npm run build       # dist/ — 백엔드가 같은 포트에서 SPA 를 제공
cd .. && pm2 start deploy/pm2.config.cjs && pm2 save    # 포트 9503
curl -s https://p3.sumzip.com/api/health
```

nginx(`/opt/homebrew/etc/nginx/servers/p03.conf`, 기존 설정)가 `https://p3.sumzip.com` → `http://192.168.0.19:9503` 으로 넘긴다. 자세한 내용은 `deploy/README.md`.

## 6. 테스트

```bash
cd backend
npm run lint && npm run format:check
npm test                    # 단위 35 (DB 불필요) + DDL 원본 동일성 확인
npm run test:integration    # 통합 77 — 원격 DB, 표식 데이터(*@test.buildcare.local · TEST-*) 생성 후 정리
npm run cleanup:test        # 중단된 통합 테스트의 표식 데이터 정리
npx tsx scripts/latency-report.ts   # 성능 측정 → docs/perf.md

cd ../frontend
npm run lint && npm run format:check && npm run check:style   # 스타일가이드 위반 검사(hex·500 굵기·그림자·둥근 모서리)
npm test                    # 컴포넌트 8
BASE_URL=https://p3.sumzip.com npm run test:e2e   # Playwright 34 — 360px·데스크톱, axe 접근성
```

E2E 는 운영 주소에 비회원 분석 몇 건을 남긴다. 시연 전에는 `npm run db:seed:dev -- --reset` 으로 되돌린다.

## 7. 스토리별 확인 시나리오 (spec Independent Test)

| # | 스토리 | 시드로 바로 보기 | 확인 절차 | 기대 결과 |
|:--:|---|---|---|---|
| 1 | 하자 사진 AI 분석 (P1) | 시크릿 창(비회원) · general@ | S2 → 선명한 사진 1장 + 설명 → [분석 요청] | 결과 카드에 원인(순위)·대응방안 + 닫을 수 없는 '1차 참고용'·진단 책임 고지. 무료 체험 잔여 -1 |
| 1-a | G3 | — | 어두운/흐린 사진(`backend/tests/fixtures/photos/crack-dark.jpg`)으로 요청 | C2 "사진 품질이 분석에 적합하지 않아…" + [사진 다시 올리기]. 잔여 그대로 |
| 1-b | G4 | general@ 이력의 실패 건 | 설명에 `#fail` 을 넣어 요청 | "분석에 실패했습니다" + [다시 분석 요청]. 잔여 그대로 |
| 1-c | 위험 권고 | general@ 이력의 '주의' 건 | 설명에 `#danger` | 위험도 "위험" + 권고 문구. 일반 사용자에겐 버튼 없음, 건물관리자 건에는 [전문가 점검 요청] |
| 2 | 이용권 구매 (P1) | general.empty@ | S2 G2 블록 → [이용권 구매] → 건별 → 카드 `4111-1111-1111-1111` | 이용권 부여 → [분석 계속하기] 로 S2 복귀(초안 유지) |
| 2-a | G1 | general.empty@ | 카드 `4000-0000-0000-0002` | "결제가 승인되지 않아…" + 사유 "카드 한도…" + [결제 정보 바꿔 다시 시도] |
| 3 | 현장 기록 (P2) | facility@ (360px) | S3 → 건물 A → 연결 가능한 결과 선택 → 위치·하자 종류·보수 '미완료'·사진 → 저장 | 저장, 하자 유형 분류. 위치 비우면 G5 + [누락 항목으로 이동] |
| 3-a | 불일치 | facility@ | AI 일치 여부 '불일치'로 저장 | 즉시 S4 검증 대기 목록에 나타남 |
| 4 | 전문가 검증 (P2) | expert@ | 대기 건 → [판정 불가] → 사유 | [검증 완료] 비활성(G6), facility@ S7B 에 추가 자료 요청 카드. 사진 추가 시 대기로 복귀 |
| 4-a | 판본 | expert@ '옥상 방수층' 건 | 판정 이력 확인 | v1(일치) · v2(불일치) 모두 표시 |
| 5 | 건물 이력 (P3) | building@ | S5 → 한빛오피스타워 A동 → 반복 하자 탭 | 시간순 통합 이력(내부·외부). 'B2 주차장 천장 누수' 반복 패턴. 아파트 101동은 G7 |
| 5-a | 외부 미반영 | enterprise@ (한빛물류센터) | 건물 C 이력 | C7 "외부 이력 미반영" 표시줄만, 화면은 정상 |
| 6 | 우선순위 (P3) | enterprise@ | S6 → 과거 산출 보기 또는 새 산출 | 순위 + '참고용'·진단 책임 고지, 권한 밖 1개 제외, 외부 미반영, 항목별 근거 이력. 재조회 시 동일 |
| 6-a | 라이선스 만료 | enterprise.ss@ | S6 | G0 "기업 라이선스가 만료되었습니다" |
| 7 | 정기점검 (P3) | building@ · facility@ | S7A 상태 5종 확인 → `npm run job:p0` | 지연 일정에 담당자 지연 알림 + 관리자 표시. 취소 일정엔 알림 없음. facility@ S7B 지연 카드 → 기록 저장 → 완료 |
| 8 | 전문가 연결 (P3) | building@ · expert@ | S8A 위험 통지 → [전문가 점검 요청] → 분야·일정 → 후보 → 고지 확인 → 동의 없이 확정 → 동의 후 확정 → expert@ S8B 수락 | 동의 전 G9, 수락 후 연결 확정·위험 통지 종료. 요율 미설정이면 수수료 기록 안 됨 |
| R | RBAC | operator@ · facility.c@ · enterprise@ | operator@ 관리 > 권한 요청 승인 → facility.c@ 건물 A 진입. enterprise@ 로 새솔빌딩 권한 부여 시도 | 승인 즉시 진입 가능(재로그인 불필요). 조직 밖 건물 부여는 403 |

## 8. 수동 배치 실행

```bash
cd backend
npm run job:p0          # 정기점검 도래·지연 감시
npm run job:no-response # 전문가 무응답 판정 (expert_response_hours 설정 시)
npm run job:bms-sync    # 건물관리시스템 동기화
```

## 9. 운영 배포

`deploy/README.md` · `deploy/pm2.config.cjs` 참조. 단일 Node 프로세스가 `/api` · `/files` · SPA 를 함께 제공하고(포트 9503), 기존 nginx 가 HTTPS 를 종단한다. nginx 기본 업로드 한도(1MB) 때문에 프런트가 사진을 긴 변 1600px·약 0.9MB 이하로 줄여 올린다.
