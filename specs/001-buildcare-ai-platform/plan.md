# Implementation Plan: Buildcare AI — 건축물 하자 AI 분석·유지관리 플랫폼

**Branch**: `001-buildcare-ai-platform` (git 저장소가 아니어서 브랜치는 만들지 않음) | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/Users/pioneer3/project261002/specs/001-buildcare-ai-platform/spec.md`
**계획 지시**: `Intent-Plan.md`(웹스택 Vue.js + Node.js, MariaDB 외 DB·Homebrew DB 금지) + 사용자 지시 "docker 컨테이너를 사용하지 않는다"

## Summary

건축물 하자 사진을 AI(Gemini Vision)로 분석해 원인·대응방안을 '1차 참고용' 고지와 함께 보여주고(1단계), 현장 점검·보수 기록과 전문가 검증으로 신뢰도를 쌓으며(2단계), 건물별 이력·반복 하자·정기점검·유지관리 우선순위·전문가 연결을 제공하는(3단계) 웹 서비스를 구현한다.

기술 접근: **Vue 3 + TypeScript SPA**(Vite·Pinia)와 **Express + TypeScript REST API**(mysql2)를 분리하고, 설계서의 **MariaDB DDL(40 테이블·16 뷰·14 트리거)을 규칙의 단일 지점**으로 그대로 적용한다. 게이트(G0~G10) 판정은 DB 뷰·트리거가 하고, API 는 그 결과를 `GateBlock` 응답으로, UI 는 C2 차단 블록으로 일관되게 표현한다. 외부 의존(AI·결제·건물관리시스템·메일·사진 저장)은 어댑터 경계 뒤에 두고 Mock 구현으로 먼저 끝까지 동작시킨다. Docker 없이 Node 프로세스로 실행하고 DB 는 원격 팀 MariaDB 를 쓴다.

## Technical Context

**Language/Version**: TypeScript 5.x — 백엔드 Node.js 20 LTS(개발 장비 v25.3 호환), 프론트엔드 Vue 3.4+
**Primary Dependencies**:
- 백엔드: Express 4.x, mysql2 3.x, @google/genai(Gemini), sharp(사진 품질 G3), exifr, multer, bcrypt, jsonwebtoken, cookie-parser, zod(입력 검증), node-cron(P0·G10·BMS 배치), nodemailer, express-openapi-validator(개발·테스트)
- 프론트엔드: Vue 3.4+, Vite 5.x, Pinia 2.x, Vue Router 4.x (UI 라이브러리 없음 — `스타일가이드.html` 토큰을 CSS 변수로)
**Storage**: 원격 MariaDB(≥10.6, 설계 검증 12.0) — `mis.iptime.org:13306` / DB `ABC11pioneer3`(서버 내부 `192.168.0.91:3306`), 접속 정보는 `backend/.env` 에만(research R3). DB 클라이언트·`docker exec` 대신 Node 스크립트로 접속. 사진은 서버 디스크 `STORAGE_DIR` + HMAC 서명 URL(R12)
**Testing**: Vitest(백엔드·프론트 단위), Supertest(API 통합 — 원격 테스트 DB), express-openapi-validator(계약), @vue/test-utils(컴포넌트), Playwright + axe(E2E·접근성, 360px·데스크톱)
**Target Platform**: 최신 모바일·데스크톱 브라우저(iOS Safari·Android Chrome 포함) / Linux·macOS 서버의 Node 프로세스(pm2), Nginx 리버스 프록시(선택)
**Project Type**: web (frontend + backend 분리)
**Performance Goals**: 적합한 사진 분석 결과 95%가 60초 이내(SC-001, AI 타임아웃 45초) · 일반 API p95 < 500ms · 화면 첫 상호작용 < 3초(모바일 4G)
**Constraints**: Docker 금지 · MariaDB 외 DB 금지(테스트용 SQLite 대체도 금지) · Homebrew DB 금지 · 로컬 DB 클라이언트 없음(Node 러너로 DDL 적용) · 고지 없는 결과 0건 · 권한 밖 정보 노출 0건 · 입력값 유실 0건 · 360px 가로 스크롤 없음 · 터치 48×48px · 명암 4.5:1
**Scale/Scope**: 사용자 스토리 8개, 역할 5종 + 비회원, 화면 10개(S1~S8B) + 공통 컴포넌트 8개(C1~C8), API 60개 연산, 테이블 40 + 확장 9. 초기 규모 가정: 기업 고객 수십 곳·건물 수천 동·월 분석 수만 건 이하(단일 백엔드 인스턴스로 시작, 배치는 DB 락으로 다중 인스턴스 대비)

미정이었던 항목(DB 접속·스키마 적용 수단·AI 모델·결제·사진 저장·비회원 처리·배치·우선순위 산식·운영 기준값·건물관리시스템)은 모두 [research.md](./research.md) R1~R21 에서 결정했다. **NEEDS CLARIFICATION 잔여 없음.** 단, 구현 착수 전 **선행 조건** 2건이 있다(§선행 조건).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` 가 이 프로젝트에 없다. 대신 상위 지시 문서(`Intent-Plan.md`, 사용자 지시)와 설계서가 정한 **비협상 원칙**을 게이트로 삼는다.

| # | 원칙 (출처) | Phase 0 판정 | Phase 1 재판정 |
|:--:|---|:--:|---|
| P1 | **지정 스택만 쓴다** — Vue 3·TS·Vite·Pinia / Node 20·Express·TS·mysql2 (Intent-Plan) | PASS | PASS — 추가 라이브러리는 지정 스택의 보조 도구뿐(R5·R19). ORM·UI 프레임워크 미도입 |
| P2 | **Docker 를 쓰지 않는다** (사용자 지시) | PASS | PASS — 개발·테스트·배포 모두 Node 프로세스(R1·R21), CI 에도 컨테이너 단계 없음 |
| P3 | **지정 DB(MariaDB) 외 DB·Homebrew DB 금지** (Intent-Plan) | PASS | PASS — 원격 MariaDB 단일(R3). 테스트도 원격 테스트 DB, SQLite·인메모리 대체 없음(R20). 세션도 DB 외 저장소 없음(R10) |
| P4 | **원천 추적성** — 모든 기능은 UC·BR·FR 로 역추적된다 (usecase 스킬·SD_01~03) | PASS | PASS — 계약 각 연산에 FR/게이트 표기, data-model §4 FR↔제약 사상 |
| P5 | **판정은 DB 뷰·트리거 한 곳** — 앱이 G0·G2·G7·상태를 재계산하지 않는다 (SD_03 §16-5) | PASS | PASS — R5, data-model §5. 오류 사상은 `sqlErrorMap.ts` 한 곳 |
| P6 | **AI 결과는 고지와 함께만 존재** — 1차 참고용·진단 책임 고지 상시 (BR-DEF-01·11, `[부정적 영향]`) | PASS | PASS — `analysis_result.notice_id` NOT NULL FK, 계약 `AnalysisResult.notice` required, `PriorityRun.notice` |
| P7 | **게이트는 차단 블록으로** — 토스트·모달 대체 금지, 문구는 gate_def 단일 원천 (SD_02 §12·§13-3) | PASS | PASS — 계약 `GateBlock` 공통 응답, `/api/gates` 로 문구 공급 |
| P8 | **설계 DDL 은 수정하지 않고 확장만** (SD_03 실행 검증 결과 보존) | PASS | PASS(정당화) — `002_app_extensions.sql` 은 신규 테이블 8 + 컬럼 1(`user_account.is_guest`). Complexity Tracking 참조 |

**결과: 모든 게이트 통과.** 위반 없음, 정당화가 필요한 확장 1건(P8)은 아래 표에 기록.

## Project Structure

### Documentation (this feature)

```text
specs/001-buildcare-ai-platform/
├── spec.md              # /speckit.specify 산출 (확정)
├── checklists/requirements.md
├── plan.md              # 이 파일
├── research.md          # Phase 0 — R1~R21 결정
├── data-model.md        # Phase 1 — 엔티티·상태 전이·FR↔제약
├── quickstart.md        # Phase 1 — 컨테이너 없는 실행·스토리별 확인
├── contracts/
│   └── openapi.yaml     # Phase 1 — REST 계약 (58 경로 · 60 연산)
└── tasks.md             # Phase 2 — /speckit.tasks 가 생성 (이 명령에서 만들지 않음)
```

### Source Code (repository root)

```text
backend/
├── package.json · tsconfig.json · .env.example · .nvmrc
├── src/
│   ├── server.ts                 # 부팅: DB 버전 확인 → app.listen → 배치 시작
│   ├── app.ts                    # Express 조립 (보안 헤더·쿠키·CSRF·OpenAPI 검증·라우터·오류 처리)
│   ├── config/env.ts             # zod 로 .env 검증
│   ├── db/
│   │   ├── pool.ts               # mysql2/promise 풀, withTransaction()
│   │   ├── migrate.ts            # DELIMITER 해석 러너 (R4)
│   │   ├── migrations/
│   │   │   ├── 001_buildcare_ddl.sql      # = Design/buildcare_ddl.sql 원본 (체크섬 고정)
│   │   │   └── 002_app_extensions.sql     # R9 확장
│   │   └── seeds/                # dev_constants.sql · dev_fixtures.ts
│   ├── gates/
│   │   ├── gateBlock.ts          # GateBlock 생성 + gate_event 기록 (FR-007)
│   │   └── sqlErrorMap.ts        # SIGNAL 45000 / CHECK 4025 → 게이트·HTTP (R5)
│   ├── middleware/               # auth(세션·기기) · requireRole · requireBuildingAccess(v_access_check) · csrf · idempotency · errorHandler
│   ├── modules/                  # 도메인별 router + service + repo
│   │   ├── auth/                 # 로그인·비회원 기기·계정 연결 (R10)
│   │   ├── reference/            # gates · codes · notices
│   │   ├── entitlement/          # P1 S1 — plans · payments · 이용권 (UC2)
│   │   ├── analysis/             # P2 S2 — 요청·품질·AI·결과 (UC1)
│   │   ├── case/                 # C1 레일 · C6 요약 · 사진 서명 URL
│   │   ├── building/             # C8 · P5 S5 — 이력·반복 하자·BMS 동기화·권한 요청 (UC5)
│   │   ├── record/               # P3 S3 — 현장 기록 (UC3)
│   │   ├── verification/         # P4 S4 — 검증·판정·자료 요청·신뢰도 (UC4)
│   │   ├── schedule/             # P7 S7A·S7B (UC6)
│   │   ├── priority/             # P6 S6 — 산식·스냅숏 (UC8, R16)
│   │   ├── expert/               # P8 S8A·S8B — 위험 통지·요청·동의·시도·연결 (UC7)
│   │   ├── notification/
│   │   └── admin/                # 기준값·고지 판본·권한 처리
│   ├── adapters/
│   │   ├── ai/                   # AiAnalyzer: gemini · mock (R7)
│   │   ├── photoQuality/         # sharp 판정 (R8)
│   │   ├── storage/              # LocalDiskStorage + 서명 URL (R12)
│   │   ├── payment/              # PaymentGateway: mock (R11)
│   │   ├── bms/                  # BmsConnector: mock · rest (R15)
│   │   └── mail/                 # console · smtp (R18)
│   └── jobs/                     # scheduler.ts · p0Watch.ts · noResponse.ts · bmsSync.ts (R13)
└── tests/
    ├── unit/                     # 산식·품질·DELIMITER 분리·오류 사상·마스킹
    ├── integration/              # Supertest + 테스트 DB: 스토리별 · 게이트별 · 트리거
    └── contract/                 # openapi.yaml 응답 검증

frontend/
├── package.json · vite.config.ts · tsconfig.json
├── src/
│   ├── main.ts · App.vue · router/index.ts (역할별 메뉴·가드)
│   ├── api/                      # fetch 래퍼 (CSRF·Idempotency-Key·GateBlock 파싱·401 복귀)
│   ├── stores/                   # Pinia: session · gates · drafts(localStorage/IndexedDB, R14) · 화면별
│   ├── styles/tokens.css · base.css   # 스타일가이드.html 토큰
│   ├── components/common/        # C1 ProgressRail · C2 GateBlock · C3 ReasonedButton · C4 ReferenceNotice
│   │                             # C5 RiskRecommendation · C6 CaseSummary · C7 SourceStatusBar · C8 BuildingPicker · StatusBadge
│   └── views/                    # S1 Purchase · S2 Analysis · S3 FieldRecord · S4 ExpertVerify · S5 BuildingHistory
│                                 # S6 PriorityDashboard · S7A ScheduleBoard · S7B MyAssignments · S8A ExpertRequest · S8B ExpertInbox · Login
└── tests/
    ├── unit/                     # 컴포넌트 (게이트 문구 일치·고지 고정·상태 3중 표현)
    └── e2e/                      # Playwright: 스토리 1~8 Independent Test + axe

.gitlab-ci.yml                    # lint → unit → integration(테스트 DB) → build (컨테이너 단계 없음)
```

**Structure Decision**: Intent-Plan 의 "프론트엔드와 백엔드가 분리된 구조"와 빠른 시작 경로(`frontend/`, `backend/`)를 그대로 따른다. 백엔드는 SD_01 의 프로세스(P0~P8)를 모듈 경계로, 프론트엔드는 SD_02 의 화면(S1~S8B)·컴포넌트(C1~C8)를 파일 경계로 삼아 설계서와 코드가 1:1 로 추적되게 한다.

## 구현 단계 (Phase 2 에서 tasks.md 로 분해할 순서)

스펙 우선순위(P1 → P2 → P3)를 따르고, 각 단계 끝에서 해당 스토리의 Independent Test 가 통과해야 다음으로 간다.

| 단계 | 범위 | 완료 기준 |
|:--:|---|---|
| 0 기반 | 저장소 골격·env 검증·DB 풀·마이그레이션 러너·001/002 적용·게이트/오류 사상·인증(로그인·비회원 기기)·CSRF·Idempotency·토큰 CSS·C1~C8·API 래퍼·Mock 어댑터 전부 | `db:migrate` 재실행 무오류, 트리거 거부 → GateBlock 사상 단위 테스트, C2 문구가 `/api/gates` 와 일치 |
| 1 스토리 1 | 분석 요청·G2·G3(sharp)·AI 어댑터·결과·고지·위험 권고·통지·재시도·비회원 체험 | quickstart 1·1-a·1-b·1-c, SC-003·004·005 자동 검증 |
| 2 스토리 2 | 요금제·결제(mock)·G1·이용권·만료·계정 연결(FR-120a) | quickstart 2·2-a, SC-006, 동시 요청 테스트(R6) |
| 3 스토리 3 | 건물 선택기·기록 draft/save·G5·사진·보수 결과 갱신·불일치 검증 대상·위험 표시 | quickstart 3·3-a, SC-008·009, 360px E2E |
| 4 스토리 4 | 검증 목록·비교·판정 판본·판정 불가/자료 요청(G6)·자동 해소·신뢰도 지표·위험 통지 | quickstart 4·4-a, SC-010 |
| 5 스토리 5 | 권한 범위 건물·통합 이력·필터·BMS 동기화(mock)·C7·반복 하자(G7)·후속 조치 이동 | quickstart 5, SC-011(이력 부분), SC-016 |
| 6 스토리 7 | 일정 CRUD·배정 통지·P0 배치·지연 이중 표시·완료 연결·취소·S7B | quickstart 7, SC-013 |
| 7 스토리 8 | 위험 통지 진입·후보(G8)·고지·동의(G9)·시도·수락/거절/무응답(G10)·연결·수수료·통지 종료 | quickstart 8, SC-014 |
| 8 스토리 6 | 기업 대시보드·라이선스 차단·우선순위 산식·스냅숏·근거·권한 밖 제외·조치 지정 | quickstart 6, SC-011·012 |
| 9 마감 | 관리 API(기준값·고지·권한 처리)·접근성·성능·보안 점검·CI·배포 스크립트 | SC-001·002·007·015·017·018 측정, axe 0 위반 |

스토리 7(정기점검)·8(전문가 연결)을 스토리 6(우선순위)보다 먼저 두는 이유: 우선순위의 조치 지정(FR-066)이 S7A·S8A 로 이동하므로 대상 화면이 먼저 있어야 한다. 스펙 우선순위는 셋 다 P3 이다.

## 선행 조건 (구현 착수 전 확보)

| # | 항목 | 필요한 단계 | 근거 |
|:--:|---|---|---|
| 1 | ~~원격 MariaDB 접속 정보~~ — **확보됨**(Intent-Plan `[데이터베이스 설정]`, 2026-10-03). 남은 일: 단계 0 첫 작업으로 `db:check` 실측(버전 ≥10.6·권한·기존 객체 없음) | 단계 0 | R3 |
| 2 | **통합 테스트용 DB** — 별도 DB(`ABC11pioneer3_test`) 생성 가능 여부. 불가하면 표식 데이터 모드로 진행 | 단계 0 | R20 |
| 3 | Gemini API 키 | 단계 1 실 연동(그 전에는 mock) | R7 |
| 4 | 결제 대행사 계약·키 | 운영 전(그 전에는 mock) | R11 |
| 5 | 고객사 건물관리시스템 엔드포인트·매핑 | 운영 전(그 전에는 mock) | R15 |

1 은 접속 실측만 남았고, 2 는 어느 쪽이든 진행 가능하다(별도 DB 가 더 안전). 3~5 는 Mock 으로 기능 개발을 막지 않는다.

## 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 원격 DB 지연·장애로 개발·테스트가 멈춤 | 전 단계 | 단위 테스트는 DB 없이 돌게 분리, 통합 테스트는 연결 실패 시 명확히 skip 사유 출력. 커넥션 풀 타임아웃·재시도 |
| 공유 DB 서버에서 테스트 데이터 간섭 | 통합 테스트 신뢰도 | 테스트 전용 DB 우선. 없으면 표식 데이터 모드(`ALLOW_TEST_ON_DEV_DB=1`, 표식 기준 정리), 병렬 실행 끔 |
| `ABC11pioneer3` 에 기존 객체가 있음 | 단계 0 | `db:check` 가 기존 테이블·트리거를 나열하고 마이그레이션 전 중단, 사용자 확인 후 진행(임의 DROP 금지) |
| MariaDB 버전 차이로 DDL 실패 | 단계 0 | 기동·마이그레이션 시 버전 확인(≥10.6), 설계 검증 버전 12.0 과 다르면 경고 |
| Gemini 응답 지연으로 SC-001 미달 | 스토리 1 | 45초 타임아웃·이미지 축소(긴 변 1600px) 후 전송, 지연 측정 로그 |
| 트리거 ERROR 1442 재발 | 데이터 쓰기 | data-model §5 규약 + 통합 테스트로 해당 경로 전수 실행 |
| 비회원 체험 남용 | 비용 | 기기 토큰 + 연결 이력으로 재발급 제한(R10). 기기 삭제 시 재발급 한계는 스펙이 감수 |

## Complexity Tracking

> Constitution Check 위반은 없다. 설계 DDL 확장(P8)만 기록한다.

| 확장 | 왜 필요한가 | 더 단순한 대안을 버린 이유 |
|---|---|---|
| `002_app_extensions.sql` — 신규 테이블 8(user_credential · guest_device · case_no_seq · inspection_record_risk · record_repair_log · photo_quality_rule · notification · schema_migration) + `user_account.is_guest` 컬럼 | 로그인(FR-001), 비회원 체험(FR-120), 건 번호 발급, UC6 E3 위험 표시·보수 결과 갱신 이력·G3 기준·서비스 내 알림(스펙 Assumptions)에 DDL 자리가 없다 | DDL 원본 수정은 SD_03 실행 검증(무오류·멱등·29건 거부 검증)을 무효화하고 설계 추적성을 깬다. 위험 표시를 `inspection_record` 컬럼으로 넣으면 기존 CHECK `chk_rec_required_on_save` 와 저장 흐름을 바꿔야 해서 별도 테이블로 분리했다 |
| 외부 연동 어댑터 6종(AI·품질·저장소·결제·BMS·메일) | 결제 대행사·건물관리시스템이 미확정이고 키 없이도 전 스토리를 개발·테스트해야 한다 | 직접 연동은 계약 전 고정 위험이 있고 테스트에 실제 외부 호출이 필요해진다 |
