# Tasks: Buildcare AI — 건축물 하자 AI 분석·유지관리 플랫폼

**Input**: `/Users/pioneer3/project261002/specs/001-buildcare-ai-platform/` — plan.md · spec.md · research.md(R1~R23) · data-model.md · contracts/openapi.yaml · quickstart.md
**추가 지시(2026-10-03)**: `Intent-Tasks.md`(Core Skills) · `Design/스타일가이드.html` 준수 · **스토리를 체험할 수 있는 시드 데이터** · **인증 시스템(RBAC) 추가 구현**
**고정 제약**: Docker 금지 · DB 는 원격 MariaDB `ABC11pioneer3` 만(접속은 Node 스크립트, `docker exec`·`mysql` 클라이언트 금지) · `Design/buildcare_ddl.sql` 수정 금지(확장은 `002_app_extensions.sql` 추가만) · 판정은 DB 뷰로만 · 게이트는 C2 차단 블록(토스트·모달 금지) · 결과·우선순위는 고지와 함께만 · 개인정보는 `v_user_masked` 필드만 · 비밀번호는 `.env` 외에 적지 않음

**Tests**: 포함한다. plan.md 단계별 완료 기준과 research R20 이 스토리별 Independent Test 자동 검증을 요구하고, RBAC 는 권한 누출 0건(SC-016)을 테스트로만 증명할 수 있다. 각 스토리의 테스트는 구현 태스크 뒤 "검증" 묶음에 둔다(통합 테스트는 원격 DB 필요).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일·선행 미완료 의존 없음 → 병렬 가능
- **[Story]**: US1~US8 = spec 사용자 스토리, RBAC = 인증·권한 관리 증분(추가 지시)
- 경로는 저장소 루트(`/Users/pioneer3/project261002/`) 기준

## Intent-Tasks Core Skills 사상

`Intent-Tasks.md` 가 지정한 다섯 역량을 작업 경로로 나눈다. 이 세션에 같은 이름의 스킬이 없으면 해당 지침을 수작업 기준으로 쓴다.

| Core Skill | 해당 작업 경로 | 적용 기준 |
|---|---|---|
| Frontend Design | `frontend/src/components/**`, `frontend/src/views/**` | `스타일가이드.html` 토큰만 사용(hex 직접 금지), 0px 모서리, 그림자 없음, 700/400/300 굵기만, 단일 블루 CTA, Semantic 색은 위험도 상태 전용 |
| Responsive Layout | `frontend/src/styles/**`, S3·S7B 전부, 모든 목록 화면 | 구간 <768 / 768–1024 / 1024–1440 / >1440, 카드 4-2-1 · 이력 3-2-1, 360px 가로 스크롤 없음, 터치 48×48px, 모바일 햄버거 내비·칩 가로 스크롤 |
| API Development | `backend/src/modules/**`, `contracts/openapi.yaml` | 계약 우선, GateBlock 공통 응답, Idempotency-Key, 마스킹 직렬화 |
| Database Design | `backend/src/db/**` | 001 = DDL 원본, 002 = 추가만, 1442 규약, 뷰 판정 |
| Authentication | `backend/src/auth/**`, `backend/src/middleware/auth*`, `backend/src/modules/auth/**`, `backend/src/modules/admin/**` | research R10 + R22 (JWT 쿠키·CSRF·RBAC·범위 판정·세션 무효화) |

---

## Phase 1: Setup (공유 골격)

**Purpose**: 컨테이너 없이 두 Node 프로젝트를 띄울 수 있는 골격

- [X] T001 `backend/package.json` 생성 — Node 20 · TypeScript 5 · Express 4 · mysql2 3 · zod · bcrypt · jsonwebtoken · cookie-parser · multer · sharp · exifr · @google/genai · node-cron · nodemailer, dev: tsx · vitest · supertest · express-openapi-validator · @types/*. scripts: `dev`(tsx watch src/server.ts) · `build` · `start` · `test` · `test:integration` · `db:check` · `db:migrate` · `db:seed:dev` · `job:p0` · `job:no-response` · `job:bms-sync`
- [X] T002 [P] `backend/tsconfig.json`(strict, ES2022, NodeNext) · `backend/.nvmrc`(20) · `backend/.gitignore`(`.env`, `storage/`, `dist/`)
- [X] T003 [P] `backend/.env.example` — quickstart §3 의 모든 키 + `SEED_DEMO_PASSWORD=` · `SEED_ALLOW_RESET=0` · `AUTH_LOCK_MAX_FAILS=5` · `AUTH_LOCK_MINUTES=15` · `ALLOW_TEST_ON_DEV_DB=0`. `DB_HOST=mis.iptime.org` `DB_PORT=13306` `DB_USER=pioneer3` `DB_NAME=ABC11pioneer3`, **`DB_PASSWORD` 는 빈 값**
- [X] T004 [P] `frontend/` Vite 5 + Vue 3.4 + TS 프로젝트 생성(`package.json`, `vite.config.ts` — `/api`·`/files` → `http://localhost:3000` 프록시, `tsconfig.json`, `index.html` lang="ko"), 의존성 Pinia 2 · Vue Router 4, dev: vitest · @vue/test-utils · jsdom · @playwright/test · @axe-core/playwright
- [X] T005 [P] 두 프로젝트 ESLint + Prettier 설정 `backend/.eslintrc.cjs`, `frontend/.eslintrc.cjs`, 루트 `.prettierrc` — 규칙: frontend 에서 `#[0-9a-f]{3,6}` 리터럴 금지(stylelint 대신 eslint 정규식 규칙 또는 `scripts/check-hex.mjs`)
- [X] T006 [P] `backend/vitest.config.ts`(unit: `tests/unit/**`) · `backend/vitest.integration.config.ts`(integration: `tests/integration/**`, `singleThread`, DB 미접속 시 사유 출력 후 skip)
- [X] T007 [P] `frontend/vitest.config.ts` · `frontend/playwright.config.ts`(projects: `mobile-360`(360×740) · `desktop`(1280×800), webServer 두 개 기동)
- [X] T008 [P] `.gitlab-ci.yml` — stages `lint → unit → integration → build`, 컨테이너 이미지 지정 없이 셸 러너 전제, integration 은 CI 변수의 테스트 DB 로
- [X] T009 [P] `frontend/src/styles/tokens.css` — `스타일가이드.html` §10 CSS 토큰을 그대로 복사 + 타입 스케일 변수(display-xl 64/700/1.05 … caption 12/400/1.4/+0.5, button 14/700/+0.5, nav-link 14/400/+0.3), 모바일 display-xl 40px
- [X] T010 [P] `frontend/src/styles/base.css` — 리셋, 전역 `border-radius: var(--r-none)`, `box-shadow: none`, `font-family: var(--font)`, 굵기 700/400/300 외 금지, 본문 300, 포커스 링(2px `--ink`), 최소 터치 48px 유틸, 컨테이너 max 1440 + 좌우 16px(모바일), 12컬럼 그리드 유틸, 섹션 간격 80/80/48, 브레이크포인트 768·1024·1440

**Checkpoint**: `npm install` 후 두 프로젝트 `npm run dev` 가 빈 화면/헬스 응답으로 뜬다.

---

## Phase 2: Foundational (모든 스토리의 선행 조건)

**Purpose**: DB 적용 · 게이트 · 인증·RBAC 코어 · 공통 컴포넌트 · 시드 프레임워크. **이 단계가 끝나기 전에는 어떤 스토리도 시작하지 않는다.**

### 2-A 데이터베이스 (Database Design)

- [X] T011 `backend/src/config/env.ts` — zod 로 `.env` 검증(DB_* 필수, `DB_PASSWORD` 비어 있으면 기동 거부 메시지), 타입 export
- [X] T012 `backend/src/db/pool.ts` — mysql2/promise 풀(`dateStrings`, `timezone: 'Z'`, `connectTimeout` 10s), `withTransaction(fn)`, `assertServerVersion()`(≥10.6 아니면 throw, 12.0 아니면 경고)
- [X] T013 [P] `backend/src/db/sqlSplitter.ts` — `DELIMITER` 지시어 해석 분리기(주석·문자열 안의 `;` 무시) + `backend/tests/unit/sqlSplitter.test.ts`(DDL 원본을 넣어 트리거 14개가 한 문장씩 나오는지)
- [X] T014 `backend/src/db/migrate.ts` — `schema_migration` 부트스트랩 → `migrations/*.sql` 파일명 순 실행 → 체크섬 기록, 체크섬 불일치 시 중단. `npm run db:migrate`
- [X] T015 `backend/src/db/migrations/001_buildcare_ddl.sql` — `Design/buildcare_ddl.sql` 바이트 동일 복사 + `backend/scripts/verify-ddl-copy.mjs`(두 파일 SHA-256 비교, `npm test` 전 실행)
- [X] T016 `backend/src/db/migrations/002_app_extensions.sql` — **추가만**(멱등 `IF NOT EXISTS`): research R9 테이블(user_credential · guest_device · case_no_seq · inspection_record_risk · record_repair_log · photo_quality_rule + 기본 규칙 4행 · notification · schema_migration) + `user_account.is_guest`(`ADD COLUMN IF NOT EXISTS`) + **R22 RBAC/인증**(user_system_role · rbac_permission · rbac_role_permission · rbac_audit_log · auth_login_attempt · idempotency_record, `user_credential.token_version`·`disabled_at`) + `service_constant` 행 `expert_fee_base`(NULL, 수수료 기준 미정 — SD_03 §"요율 × 기준(미정)") + `priority_w_*` 가중치 키(R16 기본값)
- [X] T017 `backend/src/db/migrations/003_rbac_seed.sql` — `rbac_permission` 카탈로그 행과 R22 기본 매트릭스(`rbac_role_permission`)를 `INSERT … WHERE NOT EXISTS` 로. 카탈로그는 T024 `permissions.ts` 와 같은 목록(불일치 시 기동 경고)
- [X] T018 `backend/scripts/db-check.ts`(`npm run db:check`) — 접속 대상(host/port/DB 이름, 비밀번호 제외) 출력 → `SELECT VERSION()` → `SHOW GRANTS` → 대상 DB 의 기존 테이블·뷰·트리거 수. `schema_migration` 없이 다른 객체가 있으면 **종료 코드 2로 멈추고 사용자 확인 요청**(임의 DROP 금지). 테스트 DB 생성 권한 여부를 R20 의 1/2 모드로 판정해 출력
- [X] T019 원격 DB 적용: `npm run db:check` → (확인 후) `npm run db:migrate` 두 번 실행해 멱등 확인. 결과(테이블 40+확장, 뷰 16, 트리거 14, 2회차 무변경)를 `backend/docs/db-apply-log.md` 에 기록

### 2-B 게이트·오류 (API Development)

- [X] T020 [P] `backend/src/gates/sqlErrorMap.ts` — `SIGNAL 45000` 메시지 접두어(`G1:` `G2:` `G3/G4:` `G6:` `G10:` `BR-DEF-03:` `UC3 E4:` `P7:`) → 게이트·HTTP, errno 4025(CHECK) → 422, 1062 → 409. **사상은 이 파일 한 곳만** + `backend/tests/unit/sqlErrorMap.test.ts`
- [X] T021 `backend/src/gates/gateBlock.ts` — `gate_def` 캐시 로드, `blockFor(gate, {reason, actions, missingFields, subject})` 가 `gate_event` 를 기록하고 계약 `GateBlock` 을 만든다. `selfRelease` 는 G0(권한 없음)·G6·G7·G10 에서 false(FR-006)
- [X] T022 `backend/src/middleware/errorHandler.ts` — GateBlockError → 계약 상태코드표(openapi 상단), sqlErrorMap 결과, zod 오류 → 422 Problem, 그 외 500(내부 메시지 숨김, requestId)
- [X] T023 [P] `backend/src/lib/mask.ts` — 응답 직렬화 헬퍼: 사용자 정보는 `v_user_masked` 조인 결과만 받는 타입(`MaskedUser`)으로 강제 + `backend/tests/unit/mask.test.ts`

### 2-C 인증·RBAC 코어 (Authentication) — research R10 · R22

- [X] T024 [P] `backend/src/auth/permissions.ts` — 권한 코드 카탈로그(const enum + 설명 + locked 여부). 최소 목록: `analysis.create` `analysis.read.own` `entitlement.read.own` `entitlement.purchase` `guest.link` `case.read` `photo.read` `building.list` `building.history.read` `building.bms.sync` `record.create` `record.repair.update` `verification.read` `verification.judge` `verification.request_data` `trust_metric.read` `schedule.manage` `schedule.read.assigned` `org.dashboard.read` `priority.run` `risk_notice.read` `risk_notice.dismiss` `expert_request.create` `expert_attempt.respond` `notification.read.own` `permission_request.create` `permission_request.resolve` `building_access.grant` `admin.users.manage` `admin.rbac.manage` `admin.constants.manage` `admin.notices.manage` `gate_event.read`. 화면→권한 표(`S1: entitlement.purchase` … `S8B: expert_attempt.respond`, `ADMIN: admin.users.manage|building_access.grant`)도 여기서 export
- [X] T025 [P] `backend/src/auth/password.ts`(bcrypt cost 12, 최소 10자 정책) · `backend/src/auth/tokens.ts`(JWT `{sub, tv}` 서명·검증, 12시간 + 슬라이딩 재발급, 쿠키 `bc_session` httpOnly·Secure(prod)·SameSite=Lax) · `backend/src/auth/deviceToken.ts`(`bc_device` 무작위 32바이트, DB 에는 SHA-256 해시만, 90일)
- [X] T026 `backend/src/auth/rbacRepo.ts` + `backend/src/auth/rbacService.ts` — 유효 역할 = `user_role` ∪ `user_system_role` ∪ (is_guest → `guest`), 권한 = `rbac_role_permission` 합집합. 프로세스 캐시 60초 + `invalidateUser(id)`/`invalidateAll()`
- [X] T027 `backend/src/middleware/authenticate.ts` — 세션 쿠키 검증 → `user_credential.token_version`·`disabled_at` 대조(불일치·비활성 → 세션 삭제 후 401 G0) → `req.auth = {userId, isGuest, roles, permissions, orgId}`. 세션 없고 `bc_device` 있으면 비회원 컨텍스트
- [X] T028 `backend/src/middleware/authorize.ts` — `requirePermission(...codes)`(미로그인 401 G0 + `actions:[login]`, 권한 없음 403 G0 + `[권한 요청 보내기]`), `requireBuildingAccess(kind, paramResolver)`(`v_access_check` 만), `requireCaseAccess(kind)`(소유자 또는 건 건물 권한; 비회원 미연결 건은 소유 기기만 — FR-120b), `requireOrgScope()`(기업 관리자 소속 조직). 모든 거부는 `gate_event` 기록
- [X] T029 [P] `backend/src/middleware/csrf.ts`(이중 제출 `bc_csrf` 쿠키 ↔ `X-CSRF-Token`, GET/HEAD 제외) · `backend/src/middleware/idempotency.ts`(`Idempotency-Key` + userId + route 로 `idempotency_record` 조회, 처리 중/완료 응답 재사용, 24시간)
- [X] T030 `backend/src/modules/auth/authService.ts` — 로그인(이메일 정규화, `auth_login_attempt` 로 5회 실패 15분 잠금 → 423 + 남은 시간, 성공 시 시도 기록 정리), 로그아웃, `me`(roles · permissions · menu = 권한에서 유도 · `v_user_masked` 필드), 비밀번호 변경(`token_version+1`)
- [X] T031 `backend/src/modules/auth/authRouter.ts` — `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/password` · `GET /api/auth/csrf`. `/api/auth/link-guest` 는 US2 에서 구현(여기서는 501 자리표시 없이 라우트 미등록)
- [X] T032 `backend/src/modules/permission/permissionRouter.ts` — `POST /api/permission-requests`(`permission_request.create`, 건물/조직·요청 화면 기록, 권한 부여자에게 알림) — 모든 G0 블록의 [권한 요청 보내기] 대상이라 기반 단계에 둔다
- [X] T033 [P] `contracts/openapi.yaml` 갱신 — `Me` 에 `permissions: string[]`, `roles` enum 에 `operator`·`guest`, `/api/auth/password` · `/api/auth/csrf` 추가, 423 응답. (관리 API 는 Phase 5 T094)
- [X] T034 [P] `specs/001-buildcare-ai-platform/data-model.md` §1 에 "I. 인증·RBAC 확장" 표(R22 테이블)와 §4 에 FR-001·FR-002·FR-003 ↔ RBAC 강제 지점 행 추가

### 2-D 앱 조립·참조 데이터·공통 어댑터

- [X] T035 `backend/src/app.ts` — 보안 헤더(직접 설정: `X-Content-Type-Options` · `Referrer-Policy` · `Content-Security-Policy` 기본 · `Strict-Transport-Security`(prod)), `express.json({limit:'1mb'})`, cookie-parser, csrf, authenticate, 개발·테스트 모드 `express-openapi-validator`(응답 검증 포함), 라우터 마운트, errorHandler. `backend/src/server.ts` — env → `assertServerVersion` → listen(:3000) → `jobs/scheduler.start()`
- [X] T036 [P] `backend/src/modules/reference/referenceRouter.ts` — `GET /api/gates` · `GET /api/codes`(defect/building type) · 현재 고지 판본 조회 헬퍼 `noticeRepo.current(kind)`
- [X] T037 [P] `backend/src/adapters/storage/LocalDiskStorage.ts` + `backend/src/adapters/storage/signedUrl.ts`(HMAC `FILE_URL_SECRET`, 5분) + `GET /files/:token` 스트리밍 라우트 `backend/src/modules/files/filesRouter.ts`
- [X] T038 [P] `backend/src/adapters/mail/` — `MailTransport` 인터페이스 · `ConsoleMail` · `SmtpMail`(nodemailer)
- [X] T039 [P] `backend/src/modules/notification/` — `notify(recipientId, kind, ref, title)`(notification 행 + 메일), `GET /api/me/notifications` · `POST /api/me/notifications/{id}/read`(`notification.read.own`)
- [X] T040 [P] `backend/src/jobs/scheduler.ts` — node-cron 등록 + `withJobLock(name, fn)`(MariaDB `GET_LOCK('job:<name>',0)`), 각 잡을 CLI 로도 실행하는 `backend/src/jobs/cli.ts`

### 2-E 시드 프레임워크 (research R23)

- [X] T041 `backend/src/db/seeds/dev_constants.sql` — R17 값(`free_trial_count=3` · `pattern_min_records=2` · `due_soon_days=7` · `expert_response_hours=48` · `ai_low_confidence=0.6`), 요금제 시연 금액(건별 3,000 · 월 29,000 — 화면 표시용), 개발 전용 건물 유형 `office`(사무시설). `expert_fee_rate`·`expert_fee_base`·`retention_days` 는 NULL 유지
- [X] T042 `backend/src/db/seeds/lib/seedContext.ts` — 가드(`NODE_ENV=production` 거부, 대상 DB 이름 출력, `--reset` 은 `SEED_ALLOW_RESET=1` 일 때만 업무 테이블을 FK 역순 TRUNCATE 대신 DELETE — 기준 데이터·`schema_migration`·`rbac_*` 카탈로그 보존), 상대 날짜 헬퍼(`daysFromToday(n)`), 비밀번호(`SEED_DEMO_PASSWORD` 또는 무작위 1회 출력), 생성 ID 레지스트리(이메일·건물 키 → id)
- [X] T043 [P] `backend/src/db/seeds/lib/photoFactory.ts` — sharp 로 결정적 합성 JPEG 생성: `good`(1280×960, 하자 종류별 패턴: 균열=사선 노이즈·누수=번짐·결로=점무늬), `dark`(평균 휘도<0.08), `blurry`(가우시안 블러 σ8), `small`(480×360). `STORAGE_DIR/seed/` 에 저장하고 storage_key 반환. 같은 파일을 `backend/tests/fixtures/photos/` 에도 생성(단위·E2E 업로드용)
- [X] T044 `backend/src/db/seeds/base.ts` — 조직·건물·계정·역할·건물 권한·전문가 프로필(부록 A 표 그대로). 계정마다 `user_credential`(bcrypt) 생성, 운영자는 `user_system_role`
- [X] T045 `backend/src/db/seeds/index.ts`(`npm run db:seed:dev [--reset] [--only=us1,us3,rbac]`) — base → dev_constants → 선택된 스토리 시드 순서 실행, 각 스토리 시드는 **서비스 계층 함수 또는 상태 전이 순서 SQL** 로만 넣는다(트리거를 통과해야 함). 끝에 계정표(이메일·역할·체험할 스토리)와 "시연 동선" 링크를 출력. 스토리 시드 파일이 아직 없으면 건너뛰고 표시

### 2-F 프론트엔드 기반 (Frontend Design · Responsive Layout)

- [X] T046 `frontend/src/api/client.ts` — fetch 래퍼: credentials include, CSRF 헤더(`/api/auth/csrf` 선획득), 지정 요청 `Idempotency-Key`(uuid, 재시도 시 동일 키 유지), 응답이 GateBlock 이면 `GateBlockError`, 401 → 현재 경로·초안 보존 후 `/login?returnTo=` , 네트워크 오류 → `NetworkError`(화면이 [다시 시도] 표시)
- [X] T047 [P] `frontend/src/stores/session.ts`(me · roles · permissions · `can(code)` · login/logout) · `frontend/src/stores/gates.ts`(`/api/gates` 캐시, `messageOf(gate)`) · `frontend/src/stores/drafts.ts`(localStorage 300ms 디바운스, 사진은 IndexedDB, 키 = 화면+대상 id, 저장 성공 시 삭제)
- [X] T048 [P] `frontend/src/composables/useCan.ts` + `frontend/src/directives/vCan.ts`(권한 없으면 숨김; `mode="disable"` 이면 C3 로 사유 표시)
- [X] T049 `frontend/src/router/index.ts` — 라우트 `/login` `/analysis`(S2) `/purchase`(S1) `/records/new`(S3) `/verification`(S4) `/buildings/:id?/history`(S5) `/org/priority`(S6) `/buildings/:id/schedules`(S7A) `/me/assignments`(S7B) `/expert-requests/new`(S8A) `/expert-inbox`(S8B) `/admin/*`, `meta.permission`. 전역 가드: 미로그인 + 권한 필요 → `/login?returnTo`, 권한 없음 → **리다이렉트하지 않고** 같은 URL 에 `ForbiddenView`(C2 G0 블록 + [권한 요청 보내기]) 렌더(FR-003)
- [X] T050 `frontend/src/App.vue` + `frontend/src/components/layout/AppHeader.vue` — 메뉴 = `me.menu`(권한 유도), 데스크톱 nav-link / <768 햄버거(48px 아이콘 버튼, `--r-full` 허용), 알림 목록 진입, 마스킹 이름, 로그아웃. `frontend/src/components/layout/PageContainer.vue`(1440 max, 그리드)
- [X] T051 [P] `frontend/src/components/base/` — `BaseButton.vue`(primary · secondary · text-link(UPPERCASE·1.5px·›) · on-dark, 높이 48, `aria-busy` "처리 중" 고정) · `BaseInput.vue`(48px, 1px hairline-strong, 포커스 ink, 오류 문구 `--error`) · `FilterChips.vue`(모바일 가로 스크롤) · `CategoryTabs.vue` · `OptionTile.vue`(selected = 2px primary) · `SpecCell.vue` · `HistoryCard.vue`(surface-card 사진 플레이트 + 제목 아래) · `AlertBox.vue`(정상/권고/위험 — 아이콘·글자·색)
- [X] T052 [P] `frontend/src/components/common/StatusBadge.vue` — 정상·완료 / 주의·지연·신뢰도 낮음 / 위험·차단 / 1차 참고용 / 해당 없음을 **글자 + 색 + 형태(●▲■◆–)** 로 동시 표현(FR-100)
- [X] T053 [P] `frontend/src/components/common/C1ProgressRail.vue` — 변형 case(분석>현장 기록>전문가 검증>조치) · building(이력·지연·연결 대기 수) · worker(배정·지연·자료 요청 수), 해당 없음 글자 표기, 현재·차단 단계 `aria-current`
- [X] T054 [P] `frontend/src/components/common/C2GateBlock.vue` — 첫 줄 = `gates.messageOf(gate)`(문구 하드코딩 금지), 사유·해제 주체·다음 행동 버튼, `selfRelease=false` 면 요청 보내기 행동만, 닫기 버튼 없음, `role="region"` + `aria-live="polite"`(토스트·모달 사용 금지)
- [X] T055 [P] `frontend/src/components/common/C3ReasonedButton.vue` — 비활성이어도 포커스 가능(`aria-disabled` + `aria-describedby`), 사유 문구 = C2 첫 줄과 동일 문자열(FR-005), 클릭 시 동작 없음
- [X] T056 [P] `frontend/src/components/common/C4ReferenceNotice.vue`(고지 판본 본문 + 판본 id, 닫기·접기 없음, 인쇄 시에도 표시 `@media print`) · `C5RiskRecommendation.vue`(위험도 StatusBadge + 권고 문구, [전문가 점검 요청]은 `can('expert_request.create')` 일 때만 — FR-121)
- [X] T057 [P] `frontend/src/components/common/C6CaseSummary.vue`(펼침·접힘·행) · `C7SourceStatusBar.vue`(외부 미반영 · 제외 N개 · 신뢰도 낮음) · `C8BuildingPicker.vue`(권한 범위 건물만, 데스크톱 드롭다운 / 모바일 전체 화면 목록) · `PhotoThumb.vue`(서명 URL 지연 로드, alt = "하자 종류 - 위치 - 촬영일")
- [X] T058 `frontend/src/views/LoginView.vue` + `frontend/src/views/ForbiddenView.vue` — 로그인 성공 시 `returnTo` 복귀 + 초안 복원, 423 잠금 안내(C2 형식 아님 — 게이트가 아니므로 폼 오류 영역), ForbiddenView 는 C2 G0 + [권한 요청 보내기] → T032

### 2-G 기반 검증

- [X] T059 [P] `backend/tests/unit/rbac.test.ts` — 기본 매트릭스로 역할별 권한 집합 계산, 다중 역할 합집합, guest 제한, locked 권한
- [X] T060 `backend/tests/integration/auth.test.ts` — 로그인 성공/실패, 5회 실패 잠금, 비밀번호 변경 후 기존 세션 401, CSRF 없는 POST 403, `me.menu` 가 권한과 일치
- [X] T061 `backend/tests/integration/rbac-matrix.test.ts` — `permissions.ts` 의 라우트 표를 순회해 역할 7종(guest·general·facility·building·enterprise·expert·operator) × 보호 라우트 응답이 401/403/2xx 기대값과 일치하는지 자동 생성 테스트, 403 응답 본문이 GateBlock G0 인지 확인 (SC-016 근거)
- [X] T062 [P] `frontend/tests/unit/gate-components.test.ts` — C2 첫 줄 = C3 사유 = gates 스토어 문구, C4 에 닫기 요소 없음, StatusBadge 가 글자·형태를 함께 렌더

**Checkpoint**: 원격 DB 에 001·002·003 적용, `db:seed:dev` 가 base 계정을 만들고 로그인 → 역할별 메뉴가 다르게 보이며, 권한 없는 URL 은 G0 블록을 보인다.

---

## Phase 3: User Story 1 — 하자 사진 AI 분석 (P1) 🎯 MVP

**Goal**: 사진 + 설명 → 원인(순위)·대응방안 + 닫을 수 없는 고지, 위험·신뢰도 낮음이면 권고. 비회원 무료 체험 포함.
**Independent Test**: 무료 체험이 남은 사용자(또는 비회원)가 사진 1장과 설명을 올려 결과 카드에서 원인·대응방안·'1차 참고용'·진단 책임 고지를 확인한다(quickstart 1·1-a·1-b·1-c).

### Implementation

- [X] T063 [P] [US1] `backend/src/adapters/photoQuality/sharpQuality.ts` — research R8 판정(형식 · 짧은 변 ≥640 · 휘도 0.08~0.92 · 라플라시안 분산), 기준·사유는 `photo_quality_rule` 에서 로드, `exifr` 촬영일 + `backend/tests/unit/photoQuality.test.ts`(T043 의 good/dark/blurry/small)
- [X] T064 [P] [US1] `backend/src/adapters/ai/` — `AiAnalyzer` 인터페이스, `MockAnalyzer`(시나리오: `normal`·`caution`·`danger`·`lowconf`·`fail`·`timeout`; `MOCK_AI_SCENARIO` 또는 설명에 `#danger` 같은 태그), `GeminiAnalyzer`(@google/genai, `GEMINI_MODEL`, responseSchema, 긴 변 1600px 축소, 45초 타임아웃, 스키마 위반 = 실패), 지연 시간 로그
- [X] T065 [US1] `backend/src/modules/case/caseNoService.ts` — `case_no_seq` FOR UPDATE 로 `D-YYYY-NNNN` 발급
- [X] T066 [US1] `backend/src/modules/analysis/analysisRepo.ts` — 건·요청·사진 생성, 이용권 선택(무료 체험 → 건별 → 월 구독 만료 임박 순) + `FOR UPDATE`, `req_status` 전이(received→quality_rejected|analyzing→failed), 결과·원인·대응 삽입(`notice_id` = 현재 analysis 판본), 1442 규약 준수
- [X] T067 [US1] `backend/src/modules/analysis/analysisService.ts` — 흐름: 무료 체험 이용권 보장(계정·기기 합산 `free_trial_count`, NULL 이면 발급 안 함, 기기 이력 있으면 재발급 안 함 — R10) → G2(`v_analysis_eligibility`) → G3(AI 미호출) → analyzing → AI → 결과(위험도는 `ai_low_confidence` 미만이면 최소 caution, R7) | G4(failed). 재시도는 같은 건·사진 복사로 새 요청, 3회 연속 실패면 운영 문의 안내 필드
- [X] T068 [US1] `backend/src/modules/analysis/analysisRouter.ts` — `POST /api/analysis-requests`(multer 메모리, 장당 15MB·10장, 0장 422, Idempotency, `analysis.create`; 비회원은 `bc_device` 발급) · `GET /api/analysis-requests/{id}`(`analysis.read.own` 또는 case 권한) · `POST /api/analysis-requests/{id}/retry` · `GET /api/me/entitlements`(잔여 표시용, `v_entitlement_balance`)
- [X] T069 [US1] `backend/src/modules/case/caseRouter.ts` — `GET /api/cases/{id}` · `GET /api/cases/{id}/progress`(`v_case_progress`) · `GET /api/photos/{kind}/{photoId}/url`(`requireCaseAccess` 후 서명 URL) — 응답의 사용자 정보는 마스킹만
- [X] T070 [US1] `backend/src/modules/analysis/riskFollowup.ts` — 결과 삽입 후(트리거가 `risk_notice` 생성) 건에 building_id 가 있으면 그 건물 manage 권한자에게 `notify(kind='risk_notice')`
- [X] T071 [P] [US1] `frontend/src/stores/analysis.ts` — 업로드·폴링(2초, 최대 60초)·결과·게이트 상태, drafts 연동
- [X] T072 [US1] `frontend/src/views/S2AnalysisView.vue` 입력 상태 — C1(case), 이용권 상태 줄("무료 체험 N회 남음"), 사진 다중 업로드(`accept="image/*"`, 미리보기 PhotoThumb, 삭제), 설명(선택), [분석 요청] C3, G2 블록([이용권 구매] / 비회원 [로그인하고 이용권 구매]), G3 블록 + [사진 다시 올리기](업로드 영역 포커스), 사진·설명 초안 보존. 모바일 1열·데스크톱 2열
- [X] T073 [US1] `frontend/src/views/S2AnalysisView.vue` 결과 상태 — 분석 중 진행 표시, 결과 카드(원인 순위 목록 · 대응방안 · **카드 안** C4 고지), C5 권고(위험도·권고 문구, 버튼은 권한자만), G4 블록 + [다시 분석 요청](3회 실패 시 문의 안내), 인쇄 스타일에 고지 포함
- [X] T074 [US1] `backend/src/db/seeds/stories/us1.ts` — 부록 B-US1 상태 생성(완료 결과 3종 normal/caution/danger + 고지, quality_rejected 1건, failed 1건, 체험 1회 남은 계정)

### 검증

- [X] T075 [US1] `backend/tests/integration/us1-analysis.test.ts` — 정상 결과에 notice 포함(SC-003), 위험·저신뢰 결과 100% 권고(SC-004), G3 시 AI mock 호출 0회·잔여 불변, G4 잔여 불변(SC-005), 사진 0장 422, 잔여 1회에 동시 요청 2건 → 1건만 analyzing·1건 G2(R6), 비회원 기기 한도, 일반 사용자 응답에 전문가 요청 행동 없음
- [X] T076 [P] [US1] `frontend/tests/e2e/us1.spec.ts` — 비회원·360px/데스크톱: 업로드 → 결과 → 고지 존재·닫기 없음, `#danger` 권고, 어두운 사진 G3 블록, axe 위반 0

**Checkpoint**: US1 단독 시연 가능 — `general@dev.local` 또는 시크릿 창(비회원)으로 S2.

---

## Phase 4: User Story 2 — 분석 이용권 구매 (P1)

**Goal**: 요금제 확인 → 결제 승인 후에만 이용권 → 분석 화면 복귀. 비회원 결과 계정 연결.
**Independent Test**: 무료 체험을 소진한 계정으로 요금제 선택·결제 → 이용권 생성 → S2 복귀(quickstart 2·2-a).

### Implementation

- [X] T077 [P] [US2] `backend/src/adapters/payment/` — `PaymentGateway`(`createCheckout`·`confirm`·`parseWebhook`) + `MockPaymentGateway`(테스트 카드 `4000-0000-0000-0002` = 거절 '한도 초과', 그 외 승인; 웹훅 서명 HMAC)
- [X] T078 [US2] `backend/src/modules/entitlement/entitlementService.ts` — 요금제 목록(price NULL → "요금 미설정", 결제 불가), 결제 생성(금액 시점 고정), confirm → 한 트랜잭션에서 approved + entitlement 삽입(`uq_entitlement_payment`), 거절 → declined + 사유(G1 블록), 웹훅 멱등, 월 구독 `valid_until` = +1개월
- [X] T079 [US2] `backend/src/modules/entitlement/entitlementRouter.ts` — `GET /api/plans` · `POST /api/payments`(`entitlement.purchase`, Idempotency; 비회원은 401 G0 → 로그인 후 복귀) · `POST /api/payments/{id}/confirm` · `POST /api/payments/webhook`(서명 검증, 인증 제외·CSRF 제외)
- [X] T080 [US2] `backend/src/modules/auth/guestLinkService.ts` + `POST /api/auth/link-guest`(`guest.link`) — R10 의 3단계 이전을 한 트랜잭션으로, 로그인 응답 `guestLinkable` 계산, 이후 기기 재발급 차단
- [X] T081 [P] [US2] `frontend/src/stores/entitlement.ts`
- [X] T082 [US2] `frontend/src/views/S1PurchaseView.vue` — 무료 체험 상태 → 요금제 OptionTile 2개(금액·이용 조건이 결제 버튼보다 위, U6) → mock 결제 단계 → 승인 시 `returnTo`(기본 S2)로 복귀 + S2 초안 복원, G1 블록 + [결제 정보 바꿔 다시 시도], 미로그인 진입 시 G0 → 로그인 → S1
- [X] T083 [US2] `frontend/src/components/auth/GuestLinkPrompt.vue` — 로그인 직후 `guestLinkable` 이면 [이 기기의 분석 결과 연결] 인라인 블록(모달 아님), 연결 후 남은 체험 수 표시
- [X] T084 [US2] `backend/src/db/seeds/stories/us2.ts` — 부록 B-US2(체험 소진 계정, 만료 월 구독 계정, 승인·거절 결제 이력)

### 검증

- [X] T085 [US2] `backend/tests/integration/us2-entitlement.test.ts` — 승인 전 이용권 없음, 같은 결제 confirm 2회 → 이용권 1건(SC-006), 거절 사유 필수, 만료 구독 → G2, 비회원 연결 후 체험 합산(재가입으로 증가 없음), 비회원 결제 401 G0
- [X] T086 [P] [US2] `frontend/tests/e2e/us2.spec.ts` — 체험 소진 → G2 → S1 → 승인 → S2 복귀(설명 초안 유지), 거절 카드로 G1

**Checkpoint**: MVP(1단계) 완성 — US1 + US2.

---

## Phase 5: 인증·RBAC 관리 (추가 지시) — 운영자·기업 관리자

**Goal**: 계정·역할·건물 권한·권한 요청·권한 매트릭스를 화면에서 관리하고, 변경이 즉시 반영된다(R22).
**Independent Test**: `operator@dev.local` 로 시설관리자에게 건물 C 기록 권한을 주면 그 사용자의 C8 목록에 C 가 즉시 나타나고, 회수하면 다음 요청부터 G0 이 된다. `enterprise@dev.local` 은 소속 조직 밖 건물 권한을 줄 수 없다.

### Implementation

- [X] T087 [RBAC] `backend/src/modules/admin/userAdminService.ts` — 계정 목록(마스킹, 역할·상태 필터, 페이지), 계정 생성(임시 비밀번호 1회 반환, 다음 로그인 시 변경 강제 플래그), 비활성화/재활성화(`disabled_at`, `token_version+1`), 역할 설정(업무 역할 5종 `user_role` + `operator` `user_system_role`, 마지막 operator 제거 금지), 모든 변경 `rbac_audit_log` + `rbacService.invalidateUser`
- [X] T088 [RBAC] `backend/src/modules/admin/accessAdminService.ts` — 건물 권한 부여·회수(`building_access`), 범위: operator 전체 / enterprise 는 `building.org_id = 본인 org_id` 만(`building_access.grant` + `requireOrgScope`), 감사 로그
- [X] T089 [RBAC] `backend/src/modules/admin/permissionRequestAdminService.ts` — 권한 요청 목록(operator 전체, enterprise 소속 조직 건물만) + 기존 `POST /api/admin/permission-requests/{id}` 처리 → granted 면 같은 트랜잭션에서 `building_access` 삽입, 요청자에게 알림, `gate_event` 해제 기록(release_action='permission_granted')
- [X] T090 [RBAC] `backend/src/modules/admin/rbacAdminService.ts` — 매트릭스 조회(역할 × 권한), 역할 권한 변경(operator 만, `locked` 권한 제거 금지, guest 에 관리 권한 부여 금지), `invalidateAll`, 감사 로그
- [X] T091 [RBAC] `backend/src/modules/admin/adminRouter.ts` — `GET/POST /api/admin/users` · `PATCH /api/admin/users/{id}`(status) · `PUT /api/admin/users/{id}/roles` · `POST/DELETE /api/admin/users/{id}/building-access` · `GET /api/admin/permission-requests` · `GET /api/admin/rbac/matrix` · `PUT /api/admin/rbac/roles/{role}/permissions` · `GET /api/admin/audit-log` + 기존 `/api/admin/constants*` · `/api/admin/notices` 를 각 권한 코드로 보호
- [X] T092 [RBAC] `backend/src/modules/admin/constantsNoticesService.ts` — 기존 계약의 기준값 설정(NULL = 보수적 동작)·고지 새 판본 INSERT 구현(`admin.constants.manage` · `admin.notices.manage`)
- [X] T093 [RBAC] 첫 로그인 비밀번호 변경 강제 — `authenticate` 가 플래그를 보면 `/api/auth/password` 외 403 + 프론트 `/account/password` 화면 `frontend/src/views/account/PasswordChangeView.vue`
- [X] T094 [P] [RBAC] `contracts/openapi.yaml` — T091 경로·스키마(`AdminUser` · `RoleAssignment` · `BuildingAccessGrant` · `PermissionRequest` · `RbacMatrix` · `AuditEntry`) 추가, 모든 사용자 필드는 마스킹 스키마
- [X] T095 [RBAC] `frontend/src/views/admin/AdminLayout.vue` + `AdminUsersView.vue`(표 + 모바일 카드, 역할 체크박스, 상태 토글, 건물 권한 편집 — C8 재사용) + `AdminPermissionRequestsView.vue`(승인 시 record/manage 선택) + `AdminRbacMatrixView.vue`(역할 열 × 권한 행, locked 표시, enterprise 는 읽기 전용) + `AdminConstantsView.vue`(기준값 NULL 표시 "미설정 — 보수적 동작", 고지 판본 이력). 스타일가이드 표: 1px hairline, 0px, 그림자 없음
- [X] T096 [RBAC] `backend/src/db/seeds/stories/rbac.ts` — 부록 B-RBAC(대기 권한 요청 2건, 비활성 계정, 다중 역할 계정, 감사 로그 예시)

### 검증

- [X] T097 [RBAC] `backend/tests/integration/rbac-admin.test.ts` — enterprise 의 타 조직 건물 부여 403 G0, 역할 회수 후 다음 요청 403(캐시 무효화), 비활성화 즉시 401, 마지막 operator 제거 거부, 매트릭스 변경이 `me.permissions` 에 반영, 감사 로그 기록
- [X] T098 [P] [RBAC] `frontend/tests/e2e/rbac.spec.ts` — operator 가 권한 요청 승인 → 요청자 재로그인 없이 화면 진입 가능, 권한 없는 메뉴 미노출

**Checkpoint**: 계정·권한을 코드·SQL 없이 운영할 수 있다.

---

## Phase 6: User Story 3 — 현장 점검·보수 기록 (P2)

**Goal**: 모바일에서 건물 선택 → (선택) 분석 결과 연결 → 필수 항목 + 사진 → 저장, 불일치면 자동 검증 대상.
**Independent Test**: 기록 권한 시설관리자가 360px 에서 필수 항목·사진을 넣어 저장하고 건물 이력 요약에서 확인(quickstart 3·3-a).

### Implementation

- [X] T099 [P] [US3] `backend/src/modules/building/buildingRouter.ts` — `GET /api/buildings?access=record|manage`(`v_access_check` 범위만, `building.list`) · `GET /api/buildings/{id}/rail`(`v_building_rail`, `requireBuildingAccess`)
- [X] T100 [US3] `backend/src/modules/record/recordRepo.ts` + `recordService.ts` — draft 생성(결과 연결 시 사진·원인·대응 프리필 — 비회원·미연결 결과는 연결 불가 FR-120b), draft 수정, 사진 추가(저장 실패 시 draft 유지 + 재업로드 안내 필드), 저장(앱 사전 검증으로 `missingFields` → G5 422, 통과 시 `record_status='saved'` UPDATE; 트리거 오류는 sqlErrorMap), 보수 결과 갱신(pending→completed 만, `record_repair_log`), 위험 표시(`inspection_record_risk`)
- [X] T101 [US3] `backend/src/modules/record/recordRouter.ts` — `POST /api/records` · `GET/PATCH /api/records/{id}` · `POST /api/records/{id}/photos` · `POST /api/records/{id}/save`(Idempotency) · `PATCH /api/records/{id}/repair-status` — `record.create`/`record.repair.update` + `requireBuildingAccess('record')`
- [X] T102 [P] [US3] `frontend/src/stores/record.ts`
- [X] T103 [US3] `frontend/src/views/S3FieldRecordView.vue` — **모바일 우선**: C1(case) · C8 건물 선택 → 이력 요약 SpecCell, 결과 연결 단계(건너뛰기 가능), 필수 항목 상단 고정(위치: 층·방향 선택 + 자유 입력 / 하자 종류 / 보수 결과 '완료'·'미완료' 명시 선택 / AI 일치 여부), 건물 유형 읽기 전용, 사진 `capture="environment"`, 위험 표시 토글, 한 손 조작(주 버튼 하단 고정 48px), G5 블록 + [누락 항목으로 이동](첫 누락 필드 포커스), 사진 실패 문구 "저장하지 못했습니다 - 입력한 내용은 이 기기에 남아 있습니다" + [다시 시도], 저장 후 보수 결과만 갱신 가능
- [X] T104 [US3] `backend/src/db/seeds/stories/us3.ts` — 부록 B-US3(저장 기록·draft 기록·연결 가능한 분석 결과·보수 미완료 기록)

### 검증

- [X] T105 [US3] `backend/tests/integration/us3-record.test.ts` — 필수 누락 저장 0건(SC-008), 불일치 저장 즉시 `verification_item`(SC-009), saved→draft 거부, 보수 결과 갱신 로그, 권한 없는 건물 403 G0, draft 는 집계·검증 제외, 비회원 결과 연결 거부
- [X] T106 [P] [US3] `frontend/tests/e2e/us3.spec.ts` — 360px 가로 스크롤 없음, G5 → 누락 필드 포커스, 저장 후 S5 이력 요약 반영(US5 미구현이면 rail 수 증가로 확인)

**Checkpoint**: `facility@dev.local` 로 모바일 기록 시연 가능.

---

## Phase 7: User Story 4 — 분석 결과 전문가 검증 (P2)

**Goal**: 검증 대기 목록 → 비교 → 일치/불일치 판정(판본 누적) 또는 판정 불가(자료 요청) → 신뢰도 지표.
**Independent Test**: 불일치 검증 대상 1건을 expert 계정으로 판정하고 판정 이력·신뢰도 지표 반영 확인(quickstart 4·4-a).

### Implementation

- [X] T107 [US4] `backend/src/modules/verification/verificationService.ts` — 대기 목록(`v_verification_queue`, 하자 종류 필터), 상세(사진·설명·AI 원인·대응·현장 기록·판정 이력 `v_current_verdict` + 전체 판본), 판정 저장(**item_id 를 먼저 읽어 값으로 전달 — 1442**, mismatch 면 diff_note 필수, match 면 의견 생략 가능), 판정 불가 → `data_request` 삽입 + 기록 작성자 알림, 열린 요청 중 판정 → G6 409, risk_high → (트리거 위험 통지) + 건물 관리자 알림, 신뢰도 지표 `v_ai_trust_metric`
- [X] T108 [US4] `backend/src/modules/verification/verificationRouter.ts` — `GET /api/verification-items` · `GET /api/verification-items/{id}` · `POST .../verdicts` · `POST .../data-requests` · `GET /api/trust-metrics` — `verification.*`·`trust_metric.read`, 전문가 이름은 마스킹
- [X] T109 [P] [US4] `frontend/src/stores/verification.ts`
- [X] T110 [US4] `frontend/src/views/S4ExpertVerifyView.vue` — 목록(FilterChips 하자 종류, StatusBadge 대기·자료 요청·검증), 비교 화면(데스크톱 좌우 2열 / 모바일 탭: 사진·설명·AI 결과(C4 포함)·현장 기록), 판정 폼(일치·불일치, 의견, 불일치 차이 내용, 위험 큼 체크), [판정 불가]는 별도 행동 → G6 블록 + [검증 완료] C3 비활성 + [추가 자료 요청 보내기], 판정 이력 v1·v2…, 신뢰도 SpecCell(일치율·판정 수·판정 불가 제외 표기)
- [X] T111 [US4] 시설관리자 쪽 자료 요청 처리 — `frontend/src/views/S3FieldRecordView.vue` 기록 상세에 "추가 자료 요청" AlertBox + 사진 추가(T101 재사용) → 자동 해소 확인 문구. (S7B 카드는 US7 에서)
- [X] T112 [US4] `backend/src/db/seeds/stories/us4.ts` — 부록 B-US4(waiting 2건, data_requested 1건, v1·v2 판본 1건, risk_high 판정 1건)

### 검증

- [X] T113 [US4] `backend/tests/integration/us4-verification.test.ts` — 판본 누적·덮어쓰기 없음, 열린 자료 요청 시 판정 G6, 사진 추가 → waiting 복귀, 지표 분모에 판정 불가 0건(SC-010), risk_high → 위험 통지 + 알림, expert 외 역할 403
- [X] T114 [P] [US4] `frontend/tests/e2e/us4.spec.ts` — 판정 불가 → C3 사유 = C2 첫 줄, 두 번 판정 → 이력 2판본

**Checkpoint**: 2단계 완성 — US3 + US4.

---

## Phase 8: User Story 5 — 건물별 이력·반복 하자 (P3)

**Goal**: 권한 범위 건물의 내부+외부 통합 이력, 필터·상세, 반복 하자(G7), 후속 조치 이동. 읽기 전용.
**Independent Test**: 이력이 여러 건인 건물에서 통합 이력·필터·상세·반복 하자 탭 확인, 연동 실패 시 "외부 이력 미반영"(quickstart 5).

### Implementation

- [X] T115 [P] [US5] `backend/src/adapters/bms/` — `BmsConnector`(`fetchHistory(bmsRef, since)`) · `MockBmsConnector`(결정적 외부 이력, `MOCK_BMS_FAIL=1` 또는 bms_ref 접두어 `FAIL-` 이면 실패) · `RestBmsConnector`(`config/bms/<org_id>.json` 엔드포인트·헤더·필드 매핑)
- [X] T116 [US5] `backend/src/modules/building/bmsSyncService.ts` + `backend/src/jobs/bmsSync.ts` — `bms_sync_run` 기록 + `external_history` upsert(`uq_ext_ref`), 실패 시 failed + 메시지, 화면 진입 시 마지막 성공 1시간 경과면 비동기 동기화(화면은 기다리지 않음)
- [X] T117 [US5] `backend/src/modules/building/historyService.ts` — `v_building_history`(기간·하자 종류 필터, 시간순), 항목 상세(사진 서명 URL·AI 결과+고지·판정·보수 결과), 반복 하자(`v_pattern_gate` 먼저 → 미통과면 G7 `blocked` 필드와 사유, 통과면 `v_repeat_defect` + 근거 이력), 출처 상태(`v_building_sync_state`). **쓰기 경로 없음**(FR-055)
- [X] T118 [US5] `backend/src/modules/building/buildingRouter.ts` 확장 — `GET /api/buildings/{id}/history` · `GET .../repeat-defects` · `POST .../bms-sync`(`building.bms.sync`) — `building.history.read` + `requireBuildingAccess('manage')`
- [X] T119 [US5] `frontend/src/views/S5BuildingHistoryView.vue` — C8 · C1(building rail) · C7(외부 미반영 — 화면을 막지 않음), CategoryTabs [통합 이력 | 반복 하자], 필터(기간 칩·하자 종류 칩), HistoryCard 3-up/2-up/1-up(StatusBadge, 내부/외부 출처 표기), 행 펼침 C6 상세, 반복 하자 탭: G7 블록 + 후속 조치 C3 비활성 / 패턴 카드(재발 횟수·근거 이력) + [정기점검 계획](→ S7A `?buildingId&location&defectType`) · [전문가 연결](→ S8A 동일 쿼리)
- [X] T120 [US5] `backend/src/db/seeds/stories/us5.ts` — 부록 B-US5(건물 A 반복 누수 3건 + 외부 이력 2건, 건물 B 기록 1건 → G7, 건물 C 동기화 실패 `FAIL-` bms_ref)

### 검증

- [X] T121 [US5] `backend/tests/integration/us5-history.test.ts` — 권한 밖 건물 목록 미노출·직접 접근 403(SC-016), 연동 실패에도 내부 이력 200 + 미반영 표시(SC-011), 외부 이력 중복 적재 없음, G7 시 패턴 미반환, 이력 API 에 쓰기 메서드 없음
- [X] T122 [P] [US5] `frontend/tests/e2e/us5.spec.ts` — 건물 C 에서 C7 표시줄만 붙고 목록 정상, 건물 B 반복 하자 G7

---

## Phase 9: User Story 7 — 정기점검 계획·추적 (P3)

> 스토리 6 보다 먼저 둔다(plan.md: 우선순위의 조치 지정이 S7A·S8A 로 이동하므로 대상 화면이 먼저 필요).

**Goal**: 일정 생성·배정 통지, 도래·지연 감시(이중 표시), 기록 연결로 완료, 취소 시 알림 중단, 위험 결과 권고.
**Independent Test**: 일정을 만들고 배정 → 기한 경과 시 지연 표시·통지, 기록 연결 시 완료(quickstart 7).

### Implementation

- [X] T123 [US7] `backend/src/modules/schedule/scheduleService.ts` — 목록(`v_schedule_status` 표시 상태), 생성(주기 month·quarter·half·year, 항목, 기한, 담당자는 해당 건물 record 권한자만, 반복 하자 근거 프리필) → `schedule_alert(assigned)` + 알림·메일, 수정, 취소, 완료(같은 건물 saved 기록 연결 — 트리거 P7 오류 사상), 완료 기록에 위험 표시가 있으면 `risk_notice(source=inspection)` + 건물 관리자 알림
- [X] T124 [US7] `backend/src/modules/schedule/scheduleRouter.ts` — `GET/POST /api/buildings/{id}/schedules`(`schedule.manage` + manage) · `PATCH /api/schedules/{id}` · `POST .../cancel` · `POST .../complete`(담당 시설관리자 또는 관리자) · `GET /api/me/assignments`(`schedule.read.assigned` — 배정·도래·지연·추가 자료 요청)
- [X] T125 [US7] `backend/src/jobs/p0Watch.ts`(`npm run job:p0`) — due 미발송 → 도래 알림, overdue 최초 → 담당자 지연 알림 + 건물 관리자 알림, `schedule_alert` 기록, cancelled·completed 제외, `withJobLock`
- [X] T126 [P] [US7] `frontend/src/stores/schedule.ts`
- [X] T127 [US7] `frontend/src/views/S7AScheduleBoardView.vue` — C1(building) · 일정 표(데스크톱)/카드(모바일) + StatusBadge(예정·도래·지연·완료·취소), 일정 폼(주기 OptionTile, 항목, 기한, 담당자 선택 — 마스킹 이름), S5 에서 온 쿼리 프리필, 취소 확인은 인라인(모달 금지), 지연 건 상단 고정, 위험 결과 완료 건에 C5 권고 + [전문가 점검 요청]
- [X] T128 [US7] `frontend/src/views/S7BMyAssignmentsView.vue` — **모바일 우선** 카드 목록(C1 worker rail: 배정·지연·자료 요청 수), 탭 배정/도래/지연/자료 요청, [현장 기록 시작] → S3 `?scheduleId` → 저장 성공 시 complete 호출, 자료 요청 카드 → 해당 기록 사진 추가
- [X] T129 [US7] `backend/src/db/seeds/stories/us7.ts` — 부록 B-US7(상대 날짜: 어제 기한 지연·3일 후 도래·30일 후 예정·완료·과거 기한 취소)

### 검증

- [X] T130 [US7] `backend/tests/integration/us7-schedule.test.ts` — `job:p0` 1회 실행 후 지연 일정 100% 알림 + 관리자 표시(SC-013), 취소 일정 알림 0건, 다른 건물 기록으로 완료 거부, draft 기록 연결 거부, 한 기록 두 일정 연결 거부
- [X] T131 [P] [US7] `frontend/tests/e2e/us7.spec.ts` — S7B(360px) 지연 카드 → 기록 저장 → S7A 완료

---

## Phase 10: User Story 8 — 전문가 점검 연결 (P3)

**Goal**: 건물관리자가 위험 건에서 요청 → 후보(G8) → 수수료·공유 범위 고지 → 동의(G9) → 전문가 수락(G10) → 연결·수수료·통지 종료.
**Independent Test**: 위험 권고 건에서 요청 → 동의·전달 → 수락 → 연결 확정·수수료 기록 확인(quickstart 8).

### Implementation

- [X] T132 [US8] `backend/src/modules/expert/expertRequestService.ts` — 요청 생성(건물관리자 + manage 권한만, FR-121; 위험 통지·분석·이력·우선순위·패턴 출처, 통지 출처면 `risk_notice_id` 자동), 후보(전문 분야 + 희망 기간 내 `expert_availability`, 마스킹, 없으면 G8), 미리보기(수수료 = `expert_fee_rate`×`expert_fee_base` 둘 다 있을 때만 금액, 아니면 "확정 시 기록 안 됨", 공유 범위 고정 문구, share 고지 판본), 확정(동의 체크 없으면 G9 409 — 아무 데이터도 전문가에게 노출 안 됨; 있으면 한 트랜잭션 `share_consent` + `expert_request_attempt` + 전문가 알림), 상태 `v_expert_request_status`
- [X] T133 [US8] `backend/src/modules/expert/expertAttemptService.ts` — 전문가 받은 요청 목록·상세(**동의된 범위만** 직렬화), 응답: accepted → `expert_connection`(fee 계산 위와 동일, 트리거 G10·통지 종료) + 연락처 공개(양측 실제 연락처는 이 시점부터만), declined → not_confirmed + 요청자 알림
- [X] T134 [US8] `backend/src/jobs/noResponse.ts`(`npm run job:no-response`) — `expert_response_hours` 설정 시에만 시한 경과 시도 no_response + 요청자 알림
- [X] T135 [US8] `backend/src/modules/expert/expertRouter.ts` + `backend/src/modules/riskNotice/riskNoticeRouter.ts` — `GET /api/risk-notices` · `POST .../dismiss`(조치 없음 종료) · `POST /api/expert-requests` · `GET .../{id}` · `GET .../candidates` · `GET .../preview` · `POST .../confirm`(Idempotency) · `GET /api/me/expert-attempts` · `GET /api/expert-attempts/{id}` · `POST .../respond`
- [X] T136 [P] [US8] `frontend/src/stores/expert.ts`
- [X] T137 [US8] `frontend/src/views/S8AExpertRequestView.vue` — C1(case) · C6 접힘, 위험 통지 목록 진입(건물관리자 홈 패널 `frontend/src/components/expert/RiskNoticePanel.vue`), 분야·희망 일정 입력, 후보 카드(마스킹), G8 블록 + [조건 바꾸기], **확정 전 고지 영역(수수료·공유 범위·share 판본)이 [요청 확정]보다 위**, 동의 체크 → 확정 C3 활성(U6), G9 블록, 상태 표시, G10 거절·무응답 → [다른 후보에게 요청 보내기](새 동의 필요), M Stripe 구분선은 전문가 영역 장식에만
- [X] T138 [US8] `frontend/src/views/S8BExpertInboxView.vue` — 받은 요청 목록(응답 시한), 상세(동의 범위 자료만 + C4), [수락]·[거절], 수락 후 연결 확정·연락처 표시
- [X] T139 [US8] `backend/src/db/seeds/stories/us8.ts` — 부록 B-US8(열린 위험 통지 2건, drafting·awaiting·declined→not_confirmed·connected 요청 각 1, 가능일 없는 방수 전문가로 G8 재현)

### 검증

- [X] T140 [US8] `backend/tests/integration/us8-expert.test.ts` — 동의 없는 확정 G9 + 전문가 측 조회 0건(SC-014), 수락 없는 수수료 0건, 수락 시 위험 통지 closed(connected), 일반 사용자·시설관리자 요청 생성 403, 요율 미설정 시 fee NULL, 무응답 잡은 시한 미설정이면 아무것도 안 함
- [X] T141 [P] [US8] `frontend/tests/e2e/us8.spec.ts` — building → 위험 통지 → 동의 전 G9 → 확정 → expert 수락 → 연결 확정

---

## Phase 11: User Story 6 — 유지관리 우선순위 판단 (P3)

**Goal**: 기업 관리자가 범위·기간을 골라 우선순위 스냅숏 산출(고지·신뢰도 낮음·제외 수·외부 미반영·근거), 조치 지정.
**Independent Test**: 여러 건물 이력이 있는 기업 계정으로 산출 → 고지·근거·조치 지정 확인, 재조회 시 동일(quickstart 6).

### Implementation

- [X] T142 [P] [US6] `backend/src/modules/priority/priorityCalculator.ts` — research R16 순수 함수(가중치는 `priority_w_*`), 신뢰도 low 판정(`pattern_min_records` 미설정이면 항상 low) + `backend/tests/unit/priorityCalculator.test.ts`
- [X] T143 [US6] `backend/src/modules/priority/priorityService.ts` — 라이선스 만료 → G0 블록(사유 "기업 라이선스가 만료되었습니다"), 대시보드 요약(`v_building_rail` 합계), 산출: 선택 건물 중 `v_access_check` 밖은 제외·개수 기록, 외부 동기화 실패 건물이 있으면 `external_included=false`, `priority_run`+`priority_item`+`priority_item_basis`(항목마다 ≥1 확인 후 커밋) + priority 고지 판본, 조회는 스냅숏 그대로, 조치 지정(`assigned_action` 만 UPDATE)
- [X] T144 [US6] `backend/src/modules/priority/priorityRouter.ts` — `GET /api/org/dashboard` · `POST /api/priority-runs` · `GET /api/priority-runs/{id}` · `PATCH /api/priority-runs/{id}/items/{rank}` — `org.dashboard.read`·`priority.run` + `requireOrgScope`
- [X] T145 [US6] `frontend/src/views/S6PriorityDashboardView.vue` — SpecCell 4-up(누적 분석·조치 필요·다음 정기점검·전문가 일치율), 범위(C8 다중 선택)·기간 칩, [산출] → C4(priority 판본) + C7(제외 N개 · 외부 미반영 · 신뢰도 낮음), 순위 목록(StatusBadge 신뢰도 낮음), 항목 펼침 근거 이력(S5 상세 링크), 조치: [정기점검] → S7A 프리필 · [전문가 연결] → S8A 프리필 · [조치 없음 종료] 인라인 확인, 과거 산출 목록(스냅숏 재조회)
- [X] T146 [US6] `backend/src/db/seeds/stories/us6.ts` — 부록 B-US6(한빛FM 3개 건물 이력 묶음, 과거 스냅숏 1건, 만료 조직 새솔관리)

### 검증

- [X] T147 [US6] `backend/tests/integration/us6-priority.test.ts` — 모든 항목 근거 ≥1(SC-012), 고지 없는 run 0건(SC-003), 권한 밖 제외 수 기록, 외부 실패 시 내부만 + 표시(SC-011), 재조회 결과 불변(FR-065), 만료 라이선스 G0
- [X] T148 [P] [US6] `frontend/tests/e2e/us6.spec.ts` — 산출 → 근거 펼침 → 조치 지정 → S7A 프리필 도착

**Checkpoint**: 3단계 완성 — 전 스토리 시연 가능.

---

## Phase 12: Polish & Cross-Cutting

- [X] T149 [P] 접근성 일괄 점검 `frontend/tests/e2e/a11y.spec.ts` — 모든 라우트 × (360, 1280) axe 위반 0, 키보드만으로 주요 작업 도달, 명암 4.5:1(SC-018)
- [X] T150 [P] 스타일가이드 준수 점검 `frontend/scripts/check-style.mjs` — hex 리터럴·`font-weight: 500`·`box-shadow`·0 외 `border-radius`(아이콘 버튼·아바타 제외) 검출, CI lint 단계에 연결
- [X] T151 [P] 성능 측정 — 분석 요청~결과 지연 로그 집계 스크립트 `backend/scripts/latency-report.ts`(SC-001 p95), 주요 API p95 < 500ms 측정 기록 `backend/docs/perf.md`
- [X] T152 보안 점검 — 쿠키 플래그·CSRF·서명 URL 만료·업로드 MIME 검증·SQL 바인딩 전수(`grep` 문자열 연결 쿼리 0건)·응답 직렬화에 원본 email/phone 필드 0건 검사 테스트 `backend/tests/unit/no-raw-pii.test.ts`
- [X] T153 [P] 입력 보존 회귀 — 세션 만료·네트워크 차단 시나리오 E2E `frontend/tests/e2e/draft-preservation.spec.ts`(S2·S3·S4·S7A·S8A, SC-017)
- [X] T154 [P] 배포 산출물 — `deploy/pm2.config.cjs`, `deploy/nginx.buildcare.conf`(정적 + `/api`·`/files` 프록시 + HTTPS), `deploy/README.md`(컨테이너 없음)
- [X] T155 [P] 문서 — `specs/001-buildcare-ai-platform/quickstart.md` §4 계정표를 부록 A 로 교체, §7 에 "시드로 바로 보기" 열 추가, RBAC 관리 확인 절차 추가; `backend/src/db/seeds/README.md`(부록 A·B 요약과 재생성 방법)
- [X] T156 전체 시드 회귀 — `SEED_ALLOW_RESET=1 npm run db:seed:dev --reset` 2회 연속 성공(멱등), 출력 계정으로 부록 B 의 시연 동선 전부 수동 확인 후 결과를 `backend/docs/seed-walkthrough.md` 에 기록
- [X] T157 전체 테스트 — backend `npm test && npm run test:integration`, frontend `npm test && npm run test:e2e` 녹색 확인, 실패 시 원인·조치 기록

---

## 부록 A — 시드 공통 데이터 (T044 `base.ts`)

비밀번호는 모든 시연 계정 공통으로 `SEED_DEMO_PASSWORD`(없으면 실행 시 무작위 생성·1회 출력). 이메일 도메인 `@dev.local`.

| 키 | 이름 · 내용 |
|---|---|
| ORG-HB | 한빛FM — 라이선스 만료일 = 오늘 + 365일 |
| ORG-SS | 새솔관리 — 라이선스 만료일 = 오늘 − 10일 (G0 시연) |
| BLD-A | 한빛오피스타워 A동 · office · ORG-HB · bms_ref `HB-A` (동기화 성공) |
| BLD-B | 한빛아파트 101동 · apartment · ORG-HB · bms_ref `HB-B` |
| BLD-C | 한빛물류센터 · office · ORG-HB · bms_ref `FAIL-HB-C` (동기화 실패 → C7) |
| BLD-D | 새솔빌딩 · apartment · ORG-SS (한빛 사용자에게 권한 밖 → G0) |

| 계정 | 역할 | 권한·상태 | 체험 대상 |
|---|---|---|---|
| general@dev.local | general | 무료 체험 1회 남음 | US1 |
| general.empty@dev.local | general | 무료 체험 3회 소진, 이용권 없음 | US2 (G2 → 구매) |
| general.expired@dev.local | general | 만료된 월 구독만 | US2 시나리오 5 |
| facility@dev.local | facility (+general 기능) | BLD-A·B record | US3 · US4 자료 요청 · US7 S7B |
| facility.c@dev.local | facility | BLD-C record | 권한 요청 대기 시연(BLD-A 요청 보냄) |
| building@dev.local | building | BLD-A·B manage | US5 · US7 S7A · US8 S8A |
| lead@dev.local | facility + building | BLD-C record·manage | 다중 역할 메뉴 합집합(RBAC) |
| enterprise@dev.local | enterprise | ORG-HB (A·B·C 자동 manage) | US6 · 조직 범위 권한 부여 |
| enterprise.ss@dev.local | enterprise | ORG-SS (만료) | US6 G0 라이선스 만료 |
| expert@dev.local | expert | 구조·방수, 가능일 오늘~+14일 | US4 · US8 S8B 수락 |
| expert.arch@dev.local | expert | 건축, 가능일 오늘~+7일 | US8 거절 → 다른 후보 |
| expert.busy@dev.local | expert | 방수, 가능일 없음 | US8 G8(방수·다음 주 조건) |
| operator@dev.local | operator | 시스템 운영자 | RBAC 관리 · 기준값·고지 |
| disabled@dev.local | general | 비활성화됨 | RBAC 로그인 거부 |

## 부록 B — 스토리별 시드 상태와 시연 동선

| 시드 | 만드는 상태 (트리거 순서 준수) | 시연 동선 |
|---|---|---|
| B-US1 `us1.ts` | general 소유 건 3개: 완료 결과 normal(균열) · caution(결로, 신뢰도 0.55 → 권고) · danger(누수) 각 원인 2~3·대응 2 + analysis 고지 판본 / quality_rejected 1건(사유 "사진이 너무 어둡습니다") / failed 1건 / BLD-A 소속 danger 건 1개(building@ 에 위험 통지) | general@ 로그인 → S2 → 이전 결과 3종 확인 → 새 분석 1회 → 체험 소진. 비회원은 시크릿 창에서 3회까지 |
| B-US2 | general.empty@ 체험 3회 completed / general.expired@ 월 구독 valid_until = 어제 / 결제 이력: 승인 1·거절 1(사유 '한도 초과') | general.empty@ → S2 G2 → [이용권 구매] → 건별 → 승인 → S2 복귀. 카드 `4000-0000-0000-0002` 로 G1 |
| B-RBAC | facility.c@ 의 BLD-A 권한 요청 대기 · lead@ 의 BLD-B 권한 요청 대기 · disabled@ 비활성 · 감사 로그 3건 | operator@ → 관리 > 권한 요청 승인 → facility.c@ 로 BLD-A 진입. enterprise@ 로 BLD-D 부여 시도 → 거부 |
| B-US3 | BLD-A: 저장 기록 4건(누수·B2 주차장 2건, 균열·3F 북측 1건, 결로 1건 — 보수 완료/미완료 혼합) · draft 1건(사진 없음) · 연결 가능한 facility@ 분석 결과 1건 | facility@ 360px → S3 → BLD-A → 결과 연결 → 위치 비우고 저장(G5) → 채워 저장 |
| B-US4 | 불일치 저장 기록 3건 → verification_item waiting 2 · data_requested 1(facility@ 에게 알림) · verified 1(v1 match → v2 mismatch 판본) · risk_high 판정 1(위험 통지) | expert@ → S4 → 대기 건 판정 / [판정 불가] → facility@ 로 사진 추가 → 대기 복귀 |
| B-US5 | BLD-A: B2 주차장 누수 내부 3건 + 외부 이력 2건(`HB-A`) → 반복 패턴 / BLD-B: 기록 1건 → G7 / BLD-C: `bms_sync_run` failed | building@ → S5 → BLD-A 반복 하자 → [정기점검 계획] 이동 / BLD-B G7 / (enterprise@) BLD-C 외부 미반영 |
| B-US7 | BLD-A 일정: 지연(기한 어제, facility@) · 도래(+3일) · 예정(+30일) · 완료(US3 기록 연결) · 취소(기한 −5일, 알림 없음) | building@ → S7A 상태 5종 → `npm run job:p0` → facility@ S7B 지연 카드 → 기록 저장 → 완료 |
| B-US8 | 열린 위험 통지 2(BLD-A danger 분석 · risk_high 판정) · 요청: drafting 1 · awaiting 1(expert@) · not_confirmed 1(expert.arch@ 거절) · connected 1(fee NULL — 요율 미설정) | building@ → 위험 통지 → [전문가 점검 요청] → 구조 · 이번 주 → 후보 → 동의 없이 확정(G9) → 동의 후 확정 → expert@ S8B 수락. 수수료를 보려면 operator@ 가 `expert_fee_rate`·`expert_fee_base` 설정 |
| B-US6 | ORG-HB 3개 건물의 US3·US5 이력 사용 + 과거 스냅숏 1건(외부 미반영·신뢰도 낮음 항목 포함) | enterprise@ → S6 → A·B·C + BLD-D(쿼리로 강제) 선택 → 산출 → "권한 밖 1개 제외" · 근거 펼침 · 1위 항목 [전문가 연결]. enterprise.ss@ → G0 |

---

## Dependencies & Execution Order

### Phase 의존

```text
Phase 1 Setup ─▶ Phase 2 Foundational ─┬─▶ Phase 3 US1 (P1, MVP) ─▶ Phase 4 US2 (P1)
                                       │
                                       ├─▶ Phase 5 RBAC 관리 (Foundational 만 필요 — US1·US2 와 병렬 가능)
                                       │
                                       ├─▶ Phase 6 US3 (P2) ─▶ Phase 7 US4 (P2)
                                       │        (US3 은 연결할 분석 결과에 US1 백엔드 필요 — 신규 하자 기록만이면 독립)
                                       │
                                       └─▶ Phase 8 US5 (P3) ─▶ Phase 9 US7 ─▶ Phase 10 US8 ─▶ Phase 11 US6
                                                 (US5·US6 은 US3 기록이 있어야 데이터가 의미 있음 — 시드로 대체 가능)
Phase 12 Polish ← 원하는 스토리 완료 후
```

### 스토리 간 의존

- **US1**: Foundational 만. 독립.
- **US2**: Foundational 만(G2 차단 해제 시연은 US1 과 함께).
- **RBAC**: Foundational 의 RBAC 코어(T024~T032). 다른 스토리와 독립.
- **US3**: 건물 목록(T099). 결과 연결 프리필은 US1 의 analysis 테이블·서비스를 읽기만 함.
- **US4**: US3 의 불일치 기록이 입력. 시드 B-US4 로 단독 시연 가능.
- **US5**: 읽기 전용. 시드 B-US5 로 독립.
- **US7**: 완료 처리에 US3 기록 저장 사용.
- **US8**: 위험 통지는 US1·US4·US7 트리거 산출물, 시드 B-US8 로 단독 가능.
- **US6**: 조치 지정의 이동 대상 S7A(US7)·S8A(US8).

### 스토리 내부 순서

어댑터·repo → service → router → store → view → seed → 검증. 같은 파일을 만지는 태스크(예 T072·T073 S2, T099·T118 buildingRouter, T103·T111 S3)는 순서대로.

## Parallel Examples

```text
# Phase 1 — T001 후
T002 · T003 · T004 · T005 · T006 · T007 · T008 · T009 · T010

# Phase 2 — DB 적용(T011~T019)과 별개로
T013 · T020 · T023 · T024 · T025 · T029 · T033 · T034 · T036 · T037 · T038 · T039 · T040 · T043
# 프론트 기반 — T046 후
T047 · T048 · T051 · T052 · T053 · T054 · T055 · T056 · T057

# US1
T063 (품질) · T064 (AI 어댑터) · T071 (스토어)  → 이후 T066 → T067 → T068

# US2 와 RBAC 는 팀을 나눠 동시에
[개발자 A] T077 → T078 → T079 → T082
[개발자 B] T087 → T088 → T089 → T090 → T091 → T095

# P3 착수 후
T115 (BMS 어댑터) · T126 (일정 스토어) · T136 (전문가 스토어) · T142 (우선순위 산식)
```

## Implementation Strategy

### MVP First (1단계)

1. Phase 1 → Phase 2(**T019 원격 DB 적용에서 기존 객체가 발견되면 멈추고 사용자 확인**)
2. Phase 3 US1 → **멈추고 검증**: quickstart 1·1-a·1-b·1-c + `db:seed:dev --only=us1`
3. Phase 4 US2 → 1단계 MVP 시연(비회원 체험 → 소진 → 로그인 → 구매 → 분석)

### Incremental Delivery

| 증분 | 범위 | 시연 계정 |
|---|---|---|
| 1 | US1 + US2 | 비회원 · general@ · general.empty@ |
| 1.5 | RBAC 관리 | operator@ · enterprise@ · facility.c@ |
| 2 | US3 + US4 | facility@ · expert@ |
| 3a | US5 + US7 | building@ · facility@ |
| 3b | US8 + US6 | building@ · expert@ · enterprise@ · enterprise.ss@ |

각 증분 끝에서 해당 스토리 시드를 넣고(`--only=`) 부록 B 동선을 수동 확인한 뒤 다음으로 간다.

### 주의

- 실제 Gemini·PG·BMS 키 없이 전 단계 개발 가능(Mock). 실 연동은 `.env` 의 `*_PROVIDER` 전환만.
- 공유 원격 DB 이므로 통합 테스트는 research R20 모드(별도 테스트 DB 우선)를 따른다. 시드 `--reset` 과 통합 테스트를 같은 DB 에서 동시에 돌리지 않는다.
- 커밋 단위: 태스크 1개 또는 논리 묶음 1개. 현재 저장소는 git 이 아니다 — 구현 시작 전 `git init` 여부를 사용자에게 확인한다.
