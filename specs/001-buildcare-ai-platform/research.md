# Phase 0 Research — Buildcare AI

**Feature**: `001-buildcare-ai-platform` · **Date**: 2026-10-03 · **Plan**: [plan.md](./plan.md)

Technical Context 의 미정 항목과 외부 의존마다 결정·근거·대안을 남긴다. 모든 결정은 `Intent-Plan.md`(웹스택·DB 제약), 사용자 지시("docker 컨테이너를 사용하지 않는다"), `spec.md`, `Design/` 설계서를 근거로 한다.

---

## R1. 실행 환경 — 컨테이너 없이 실행

- **Decision**: 프론트엔드·백엔드를 Node.js 프로세스로 직접 실행한다. 개발은 `npm run dev`(Vite dev server · `tsx watch`), 운영은 `vite build` 정적 산출물 + `node dist/server.js`(pm2 또는 systemd)로 띄운다. Nginx는 리버스 프록시·HTTPS 용도로만 선택적으로 둔다.
- **Rationale**: 사용자 지시로 Docker를 쓰지 않는다. Intent-Plan 의 "빠른 시작"(`cd frontend && npm run dev`, `cd backend && npm run dev`)이 이미 비컨테이너 실행을 전제한다.
- **Alternatives considered**: Docker Compose(지시로 배제), Podman 등 다른 컨테이너 런타임(같은 이유로 배제).

## R2. Node.js 버전

- **Decision**: 대상 런타임은 **Node.js 20 LTS** 이상이다(`package.json` `engines.node: ">=20"`, `.nvmrc` = `20`). 개발 장비의 Node v25.3 에서도 동작해야 하므로 Node 20 이후에 제거된 API는 쓰지 않는다.
- **Rationale**: Intent-Plan 이 "Node.js (v20 LTS)"를 지정했다. 현재 장비(v25.3)는 상위 호환이다.
- **Alternatives considered**: Node 22 LTS 고정(지정과 다름), Bun·Deno(지정 스택 아님).

## R3. 데이터베이스 — 원격 MariaDB, 접속 정보는 `.env`

- **Decision**: **원격 팀 MariaDB 서버(MariaDB A)**에 `mysql2/promise` 커넥션 풀로 연결한다. 값은 Intent-Plan.md `[데이터베이스 설정]` 을 따른다.

  | 키 | 개발(외부 접속, 권장) | 서버 내부 배포 시 |
  |---|---|---|
  | `DB_HOST` | `mis.iptime.org` | `192.168.0.91` |
  | `DB_PORT` | `13306` | `3306` |
  | `DB_USER` | `pioneer3` | 동일 |
  | `DB_NAME` | `ABC11pioneer3` | 동일 |
  | `DB_PASSWORD` | Intent-Plan.md 참조 — **`backend/.env` 에만** 기록 | 동일 |

  접속 정보는 `backend/.env` 로만 주입하고 저장소에 커밋하지 않는다(`.env.example` 은 호스트·포트·DB 이름까지만, 비밀번호는 비움). 계획·코드·문서에 비밀번호를 적지 않는다.
- **Rationale**: 상위 지시(CLAUDE.md·Intent-Plan 원본)는 설정한 MariaDB 외 DB·Homebrew 네이티브 DB 를 금지하고, 사용자 지시로 Docker 도 금지됐다. 로컬에 MariaDB 를 띄울 방법이 없으므로 원격 서버가 유일한 경로다.
- **Intent-Plan 의 `docker exec … mysql` 접속 안내는 따르지 않는다**: 이번 계획 지시("docker 컨테이너를 사용하지 않는다")가 우선하고, 같은 절이 Homebrew `mysql` 바이너리도 금지하므로 **터미널 DB 클라이언트를 쓰지 않는다**. 접속 확인·스키마 적용·조회는 모두 Node 스크립트(`npm run db:check` · `db:migrate`, R4)로 한다.
- **상태**: 접속 정보 확보됨(2026-10-03). 계획 단계에서는 접속을 실측하지 않았다 — 버전·권한·기존 객체 확인은 단계 0 첫 작업 `npm run db:check` 가 한다(버전, `SHOW GRANTS`, `ABC11pioneer3` 의 기존 테이블·트리거 수 출력). 기존 객체가 있으면 마이그레이션 전에 중단하고 사용자 확인을 받는다.
- **버전 요구**: DDL 은 MariaDB 12.0 에서 검증됐다. CHECK 강제(10.2.1+), `CREATE INDEX IF NOT EXISTS`(10.1.4+), `CREATE OR REPLACE VIEW` 를 쓰므로 **MariaDB 10.6 이상**을 최소 요구로 둔다. 기동 시 `SELECT VERSION()` 으로 확인하고 미달이면 시작을 거부한다.
- **Alternatives considered**: Docker MariaDB(지시로 배제), Homebrew MariaDB(Intent-Plan 으로 배제), SQLite·인메모리 DB 로 테스트 대체(타 DB 금지 + CHECK·트리거·뷰 의미가 달라 검증 가치가 없음).

## R4. 스키마 적용 — `mariadb` 클라이언트 없이 DDL 실행

- **Decision**: Node 마이그레이션 러너(`backend/src/db/migrate.ts`)를 만든다. `migrations/*.sql` 을 파일명 순서로 읽어 `DELIMITER` 지시어를 직접 해석해 문장을 나누고(`DELIMITER //` ~ `DELIMITER ;` 구간은 `//` 로 분리), 각 문장을 `mysql2` 로 실행한다. 적용 이력은 `schema_migration(filename, checksum, applied_at)` 테이블에 남긴다.
  - `001_buildcare_ddl.sql` = `Design/buildcare_ddl.sql` 원본 복사(수정 금지, 체크섬으로 변조 감지)
  - `002_app_extensions.sql` = 앱 운영에 필요한 **추가만 하는** 확장(R9)
- **Rationale**: 장비에 `mariadb`/`mysql` 클라이언트가 없고 Homebrew 설치도 금지된다. `DELIMITER` 는 클라이언트 지시어라 서버에 보내면 구문 오류가 난다(DDL 주석 [M3]). DDL 은 `IF NOT EXISTS`·`OR REPLACE`·`DROP TRIGGER IF EXISTS` 로 멱등이라 재실행해도 안전하다.
- **Alternatives considered**: Knex/Prisma 마이그레이션(설계서 DDL 을 ORM 스키마로 옮기면 CHECK·트리거·뷰가 유실되거나 이중 관리됨), `mysql2` `multipleStatements` 로 통째 실행(DELIMITER 를 처리하지 못함).

## R5. 데이터 접근 방식

- **Decision**: ORM 없이 `mysql2` 의 파라미터 바인딩 SQL 을 모듈별 repository 에 둔다. **판정은 뷰로만 한다**(SD_03 §16-5): G0=`v_access_check`, G2=`v_analysis_eligibility`/`v_entitlement_balance`, G7=`v_pattern_gate`, 일정 상태=`v_schedule_status`, 요청 상태=`v_expert_request_status`, 레일=`v_case_progress`·`v_building_rail`. 애플리케이션 코드에서 같은 판정을 다시 계산하지 않는다.
- **트리거 오류 사상**: 트리거의 `SIGNAL SQLSTATE '45000'` 메시지 접두어(`G1:` `G2:` `G3/G4:` `G6:` `G10:` `BR-DEF-03:` `UC3 E4:` `P7:`)를 게이트 코드로 바꿔 HTTP 오류로 돌려준다. CHECK 위반(errno 4025)은 422 로 바꾼다.
- **ERROR 1442 규약**: 트리거가 갱신하는 테이블을 같은 문장에서 읽지 않는다. `data_request`·`expert_verdict` 삽입은 `item_id` 값을 먼저 읽어 넘긴다(DDL [X1]).
- **Rationale**: Intent-Plan 이 "mysql2 · SQL 쿼리 기반 데이터 조작"을 지정했다. DB 가 규칙의 단일 지점이므로 얇은 데이터 계층이 맞다.
- **Alternatives considered**: TypeORM·Prisma(지정과 다르고 뷰·트리거 중심 설계와 맞지 않음), Kysely 쿼리 빌더(타입 이점은 있으나 지정 범위 밖 — 필요 시 도입 검토).

## R6. 동시 분석 요청과 이용권 소진 (Edge Case)

- **Decision**: 분석 시작은 한 트랜잭션에서 `SELECT ... FROM entitlement WHERE entitlement_id=? FOR UPDATE` 로 이용권 행을 잠근 뒤 `analysis_request.req_status='analyzing'` 으로 바꾼다. 트리거 `trg_request_bu` 가 같은 트랜잭션 안에서 `v_entitlement_balance` 로 잔여를 재확인하므로 두 번째 요청은 `G2:` 로 거부된다. 이용권 선택 순서는 무료 체험 → 건별 → 월 구독(만료 임박 순)이다.
- **Rationale**: 스펙 Edge Case "남은 이용권 1회에 두 요청이 동시에 들어오면 하나만 분석"과 FR-017(분석 중도 소진으로 계산).
- **Alternatives considered**: 애플리케이션 메모리 락(다중 프로세스에서 깨짐), 낙관적 재시도(실패 경로가 복잡해짐).

## R7. 외부 AI 이미지 분석 — Gemini Vision

- **Decision**: 공식 SDK `@google/genai` 로 Gemini 멀티모달 모델을 호출한다. 모델 이름은 `GEMINI_MODEL` 환경변수로 바꿀 수 있게 하고 기본값은 `gemini-2.5-flash` 로 둔다. 응답은 `responseSchema`(JSON 구조화 출력)로 `{ causes[{rank,text}], actions[{seq,text}], risk_level, confidence, defect_type_guess }` 를 강제한다. 호출 타임아웃은 45초(SC-001 의 60초 안에 품질 판정·저장 포함), 응답 스키마 위반·타임아웃·5xx 는 모두 G4 로 처리한다.
- **어댑터**: `AiAnalyzer` 인터페이스 + `GeminiAnalyzer` · `MockAnalyzer`. `AI_PROVIDER=mock` 이면 고정 결과를 돌려준다(개발·테스트·키 없는 환경).
- **위험도**: 모델이 낸 `risk_level` 을 쓰되, `confidence < service_constant.ai_low_confidence` 이면 최소 `caution` 으로 올린다(UC1 E3 → 권고 표시). 기준값이 비어 있으면 모델 값 그대로 쓴다.
- **재시도**: 사용자 재시도 무제한, 같은 요청 3회 연속 실패 시 운영자 문의 안내를 덧붙인다(스펙 Assumptions).
- **Rationale**: 원천 `[핵심 파트너] 1단계`·`[핵심 이네이블러] 1단계` 가 Gemini Vision 을 지정했다. 원천의 Python/FastAPI 는 Intent-Plan 의 Node.js 스택으로 대체한다.
- **Alternatives considered**: REST 직접 호출(SDK 가 재시도·타입을 제공), 다른 비전 모델(원천 지정과 다름).

## R8. 사진 품질 판정 (G3) — AI 호출 전 로컬 판정

- **Decision**: `sharp` 로 서버에서 판정한다. 기준: ① 형식 JPEG·PNG·WebP ② 짧은 변 ≥ 640px ③ 평균 휘도 0.08~0.92(너무 어둡거나 밝음) ④ 라플라시안 분산 기반 선명도 ≥ 임계값(흐림). 임계값과 사유 문구는 `photo_quality_rule` 설정(R9)으로 운영자가 바꾼다. 하나라도 미달이면 `req_status='quality_rejected'` + 사유를 남기고 AI 를 호출하지 않는다. 촬영일은 `exifr` 로 EXIF 에서 읽는다.
- **Rationale**: FR-012 "AI 호출 **전에** 품질 판정", SC-005 "품질 부적합 사진에 AI 분석 0건". 외부 호출 없이 판정해야 비용(`[비용] 1단계`)이 들지 않는다.
- **Alternatives considered**: AI 에게 품질도 묻기(호출 자체가 비용이고 G3 를 위반), 클라이언트 측 판정만(우회 가능).

## R9. 설계 DDL 에 없는 앱 운영 요소 — `002_app_extensions.sql`

설계 DDL 은 업무 데이터만 다룬다. 스펙이 요구하지만 DDL 에 자리가 없는 항목을 **기존 테이블을 바꾸지 않고 추가만** 한다(예외 1건은 컬럼 추가).

| 확장 | 이유(스펙) | 형태 |
|---|---|---|
| `user_credential(user_id PK/FK, password_hash, updated_at)` | 로그인(FR-001). DDL `user_account` 에 비밀번호 칸이 없다 | 신규 테이블 |
| `user_account.is_guest BOOLEAN DEFAULT FALSE` | 비회원 무료 체험(FR-120). `defect_case.owner_id`·`analysis_request.requester_id` 가 NOT NULL 이라 비회원도 계정 행이 필요 | 컬럼 추가 |
| `guest_device(device_id PK, token_hash UNIQUE, guest_user_id FK, linked_user_id FK NULL, created_at, linked_at)` | 기기 단위 체험 제한·계정 연결(FR-120a) | 신규 테이블 |
| `case_no_seq(seq_year PK, last_no)` | 건 번호 `D-2026-0142` 발급. 동시 발급 안전(FOR UPDATE) | 신규 테이블 |
| `inspection_record_risk(record_id PK/FK, risk_flag, flagged_at)` | UC6 E3 "점검 결과 위험"(스펙 Assumptions · SD_03 §19-1 #2) | 신규 테이블(기존 CHECK 보존을 위해 분리) |
| `record_repair_log(log_id, record_id, old_status, new_status, changed_by, changed_at)` | 저장 기록 보수 결과 갱신 시각 기록(스펙 Assumptions) | 신규 테이블 |
| `photo_quality_rule(rule_key PK, threshold, reason_text)` | G3 기준·사유 문구 운영자 관리(스펙 Assumptions) | 신규 테이블 + 기본값 |
| `notification(notif_id, recipient_id, kind, ref_kind, ref_id, title, created_at, read_at)` | 서비스 내 알림(배정·도래·지연·추가 자료 요청·위험 통지·요청 도착) | 신규 테이블 |
| `schema_migration` | 마이그레이션 이력(R4) | 신규 테이블 |

- **Rationale**: 설계 DDL 의 무결성 규칙(CHECK·트리거·뷰)을 그대로 보존하면서 스펙의 확정 사항(Clarifications 2026-10-03)과 Assumptions 를 구현하기 위함이다.
- **Alternatives considered**: DDL 원본 수정(설계 추적성 훼손, SD_03 검증 결과 무효화), 별도 인증 DB(타 DB 금지).

## R10. 인증·세션

- **Decision**: 이메일+비밀번호 로그인(`bcrypt` cost 12) → 서명된 JWT 를 **httpOnly · Secure · SameSite=Lax 쿠키**로 발급(만료 12시간, 슬라이딩 갱신). 상태 변경 요청은 `X-CSRF-Token` 이중 제출 토큰을 요구한다. 역할은 `user_role` 에서 읽어 토큰에 싣고, 건물·기업 권한은 매 요청 `v_access_check` 로 판정한다(토큰에 싣지 않음 — 권한 회수 즉시 반영).
- **비회원**: 첫 분석 요청 시 `guest_device` 를 만들고 무작위 기기 토큰을 별도 httpOnly 쿠키(만료 90일, 스펙 Assumptions)로 준다. 비회원 계정 행은 `is_guest=TRUE`, 역할 `general`, 이메일은 `guest+<uuid>@guest.invalid` 형식.
- **계정 연결(FR-120a)**: 로그인 직후 기기 토큰이 있으면 [이 기기의 분석 결과 연결]을 제안한다. 수락 시 한 트랜잭션에서 ① 비회원의 `defect_case.owner_id`·`analysis_request.requester_id` 를 계정으로 옮기고 ② 비회원 무료 체험 이용권으로 소진된 요청을 계정의 무료 체험 이용권으로 다시 가리켜(계정에 없으면 비회원 이용권의 `user_id` 를 계정으로 이전) 합산 횟수를 유지하며 ③ `guest_device.linked_user_id` 를 채운다. 가입·재가입으로 무료 체험이 다시 생기지 않도록 무료 체험 발급은 "계정에 연결된 적 있는 기기 또는 계정 1회"로 제한한다.
- **세션 만료**: 401 응답에 G0 블록 정보를 싣고, 프론트는 현재 경로와 입력값(R14)을 보존한 채 로그인 후 복귀한다(FR-102 · SD_02 §13-3).
- **Rationale**: Intent-Tasks 가 JWT 인증을 예로 들었다. 쿠키 보관은 XSS 로 토큰이 새는 것을 막는다.
- **Alternatives considered**: localStorage Bearer 토큰(XSS 노출), 서버 세션 저장소(별도 저장소 = 타 DB 또는 MariaDB 세션 테이블 추가 필요), OAuth(원천에 근거 없음).

## R11. 결제 수단 (G1)

- **Decision**: `PaymentGateway` 어댑터 인터페이스(`createCheckout`, `confirm`, `parseWebhook`)를 두고 첫 구현은 `MockPaymentGateway`(승인·거절을 시나리오로 선택)로 한다. 실제 PG 는 국내 카드 결제 대행 1곳(후보: 토스페이먼츠 · KG이니시스)을 계약 후 어댑터로 추가한다. 이용권 부여는 PG 승인 확인(서버 측 confirm) 뒤 한 트랜잭션에서 `payment.pay_status='approved'` → `entitlement` 삽입으로 처리하며, `uq_entitlement_payment` 가 결제 1건당 이용권 1건을 보장한다(FR-022 · SC-006).
- **금액 미설정**: `service_plan.price_amount` 가 NULL 이면 해당 요금제는 "요금 미설정"으로 표시하고 결제 버튼을 비활성화한다(FR-110 보수적 동작).
- **Rationale**: 스펙 Assumptions "구체 업체는 계획 단계에서 정한다". 업체 계약 없이 구현·테스트를 진행하려면 어댑터 경계가 필요하다.
- **Alternatives considered**: 특정 PG SDK 직결(계약 전 고정 위험), 결제 생략(1단계 수익 모델 미구현).

## R12. 사진 저장소와 서명 URL (FR-091)

- **Decision**: `StorageAdapter` 인터페이스 + `LocalDiskStorage`(백엔드 서버 디스크 `STORAGE_DIR`). DB 에는 `storage_key` 만 저장한다. 조회는 `GET /api/photos/{kind}/{id}/url` 에서 `v_access_check`(또는 분석 요청자 본인) 확인 후 HMAC 서명·만료 5분 URL 을 발급하고, `GET /files/:token` 이 서명을 검증해 파일을 스트리밍한다. 업로드는 `multer` 메모리 저장 → 품질 판정 → 디스크 기록, 장당 15MB · 요청당 10장 제한.
- **Rationale**: SD_03 §17 "객체 저장소 키만 저장, 권한 확인 후 서명 URL". 원천에 객체 저장소 서비스 지정이 없고 컨테이너도 쓰지 않으므로 서버 디스크가 가장 단순하다. 어댑터로 S3 호환 저장소로 바꿀 수 있다.
- **Alternatives considered**: DB BLOB 저장(DB 비대·백업 부담), 공개 정적 경로(권한 우회).

## R13. 배치 작업 — P0 기한 감시 · G10 무응답 · 건물관리시스템 동기화

- **Decision**: 백엔드 프로세스 안에서 `node-cron` 으로 돈다. ① P0 기한 감시: 매일 01:00 + 매시 정각 — `v_schedule_status` 가 `due` 인데 도래 알림이 없으면 `due` 알림, `overdue` 인데 `overdue_alert_sent=0` 이면 담당자 지연 알림을 `schedule_alert`·`notification` 에 남기고 메일 발송(FR-072 · SC-013). 취소 일정은 뷰에서 `cancelled` 로 빠진다(FR-074). ② G10 무응답: 매시 — `expert_response_hours` 가 설정된 경우에만 시한 경과 시도에 `response='no_response'`. ③ 건물관리시스템 동기화: 매일 02:00 + 이력 화면 진입 시 마지막 성공 후 1시간 경과 시 요청 기반 동기화. 다중 인스턴스 대비로 작업 시작 시 MariaDB `GET_LOCK('job:<name>', 0)` 으로 단일 실행을 보장한다.
- **Rationale**: 컨테이너·외부 스케줄러 없이 단일 Node 프로세스로 운영한다. 스펙 Assumptions "감시는 하루 1회 이상".
- **Alternatives considered**: OS cron + 별도 스크립트(배포 단위 증가), 메시지 큐(별도 인프라).

## R14. 입력값 보존 (FR-102 · SC-017)

- **Decision**: 입력 폼(S2·S3·S4·S7A·S8A)은 Pinia 스토어 + `localStorage` 초안 저장(입력 300ms 디바운스, 키 = 화면+대상 id)을 쓴다. 저장 성공 시 초안을 지운다. 네트워크·서버 오류 시 실패 영역에 "저장하지 못했습니다 - 입력한 내용은 이 기기에 남아 있습니다" + [다시 시도]. 처리 중 버튼은 `aria-busy` + "처리 중" 고정으로 중복 제출을 막고, 서버는 `Idempotency-Key` 헤더(결제·분석 요청·기록 저장·요청 확정)로 같은 요청을 한 번만 처리한다.
- **Rationale**: SD_02 §13-3 오류 규약, 스펙 Edge Case "중복 클릭". 사진은 용량상 IndexedDB 에 임시 보관한다.
- **Alternatives considered**: 서버 측 초안 저장만(오프라인 시 유실).

## R15. 건물관리시스템 연동

- **Decision**: `BmsConnector` 인터페이스(`fetchHistory(bmsRef, since)`)를 두고 첫 구현은 `MockBmsConnector` 와 범용 `RestBmsConnector`(JSON 엔드포인트·API 키 헤더·필드 매핑 설정)로 한다. 고객사별 엔드포인트·매핑은 `organization` 단위 설정 파일(`config/bms/<org_id>.json`)로 둔다. 적재는 `bms_sync_run` 1건 + `external_history` upsert(`uq_ext_ref` 로 중복 방지, FR-052). 실패는 `sync_status='failed'` + 오류 메시지 → `v_building_sync_state` 가 C7 "외부 이력 미반영"을 만든다.
- **Rationale**: 스펙 Assumptions "연동 방식·주기는 고객사별로 계획 단계에서 정한다". 고객사가 확정되지 않았으므로 어댑터 + 설정으로 흡수한다.
- **Alternatives considered**: 고객사별 전용 코드(확정 전 낭비), 실시간 조회(장애 시 화면 차단 — FR-052 위반).

## R16. 유지관리 우선순위 산식 (FR-061 · BR-DEF-12)

- **Decision**: 산출 단위 = (건물, 위치, 하자 종류). 점수 = `3 × 재발 횟수 + 2 × 최고 위험도(정상0·주의1·위험2) + 1 × min(미조치 개월 수, 12)/3 + 2 × 열린 위험 통지 수`. 정렬 후 상위부터 `priority_rank` 부여. 근거 이력(`priority_item_basis`)은 해당 묶음의 저장 기록·외부 이력 전부. **신뢰도**: 묶음의 이력 수 < `pattern_min_records`(미설정이면 항상 low) 이면 `low`. 가중치는 `service_constant` 확장 키(`priority_w_repeat` 등)로 운영자가 조정한다. 결과는 `priority_run` 스냅숏으로 고정해 재계산하지 않는다(FR-065).
- **Rationale**: 스펙 Assumptions "반복 횟수·위험도·미조치 기간을 반영하는 방식으로 계획 단계에서 정의". 설명 가능한 선형 가중합이 '참고용' 성격에 맞고 근거 역추적(FR-064)이 쉽다.
- **Alternatives considered**: ML 예측 모델(범위 밖 — UC8 A2 예측 서비스), 재발 횟수만 사용(위험도 무시).

## R17. 운영 기준값의 개발 기본값 (FR-110)

- **Decision**: 운영 DB 는 DDL 기본 시드대로 값이 비어 있는 상태(보수적 동작)로 시작한다. 개발·시연 DB 에만 `seeds/dev_constants.sql` 로 스펙 Assumptions 값을 넣는다: `free_trial_count=3`, `pattern_min_records=2`, `due_soon_days=7`, `expert_response_hours=48`, `ai_low_confidence=0.6`, 요금제 금액은 시연용 표시값. `expert_fee_rate` · `retention_days` 는 개발에서도 비워 둔다(수수료 미기록·자동 삭제 없음). 운영자 화면 `PUT /api/admin/constants/{key}` 로 바꾼다.
- **Rationale**: 스펙 FR-110 "값이 설정되지 않은 동안 보수적으로 동작", Assumptions 의 기본값. 운영 금액·요율 같은 사업 수치를 계획이 임의로 확정하지 않는다.
- **Alternatives considered**: 운영에도 기본값 강제(사업 결정을 개발이 대신함).

## R18. 알림 수단

- **Decision**: 서비스 내 알림(`notification` 테이블, 상단 알림 목록) + 이메일(`nodemailer` SMTP, `MAIL_*` 환경변수). 개발에서는 `MAIL_TRANSPORT=console` 로 콘솔 출력. 발송 사실은 `schedule_alert`(FR-077)에 남긴다.
- **Rationale**: 스펙 Assumptions "알림 수단은 서비스 내 알림 + 이메일".
- **Alternatives considered**: 앱 푸시·SMS(원천·스펙 근거 없음).

## R19. 프론트엔드 구조·시각 규약

- **Decision**: Vue 3.4+ Composition API(`<script setup lang="ts">`) · Vite 5 · Pinia 2 · Vue Router 4. UI 라이브러리를 쓰지 않고 `Design/스타일가이드.html` 의 토큰을 `src/styles/tokens.css` CSS 변수로 옮긴다(단일 블루 액션색 #1c69d4, 0px 직각, 그림자 없음, 700/300 굵기 대비, Semantic 색은 위험도 상태 전용). 폰트는 라이선스 폰트 대신 시스템 스택 + 굵기 대비로 재현한다(DESIGN.md "Font Substitutes"). 공통 컴포넌트 C1~C8 을 먼저 만들고 화면 S1~S8B 를 조립한다. 상태 표현은 `StatusBadge`(글자·색·형태 동시, FR-100). 터치 영역 48×48px(FR-101), 360px 폭 가로 스크롤 없음(SC-018).
- **Rationale**: Intent-Plan 프론트엔드 스택, SD_02 컴포넌트·화면 구성, FR-103.
- **Alternatives considered**: Vuetify·Element Plus(둥근 모서리·그림자 기본값이 스타일가이드와 충돌), Tailwind(토큰은 맞출 수 있으나 지정 스택 밖).

## R20. 테스트 전략

- **Decision**: 
  - **백엔드 단위**: Vitest — 순수 로직(우선순위 산식, 품질 판정, DELIMITER 분리기, 오류 사상, 마스킹).
  - **백엔드 통합**: Vitest + Supertest — **원격 MariaDB 의 테스트 전용 DB**(`DB_NAME_TEST`)에 마이그레이션을 적용하고 테스트마다 트랜잭션 롤백 또는 테이블 비우기. AI·PG·BMS·메일은 Mock 어댑터.
  - **계약 테스트**: `contracts/openapi.yaml` 을 `express-openapi-validator` 로 응답 검증(개발·테스트 모드).
  - **프론트엔드**: Vitest + `@vue/test-utils` (컴포넌트 C1~C8 · 게이트 블록 문구 일치), Playwright E2E(스토리별 Independent Test 8개, 360px·데스크톱 뷰포트, axe 접근성 검사).
- **Rationale**: 스펙의 Independent Test·SC 를 자동 검증한다. 트리거·CHECK 규칙은 실제 MariaDB 에서만 의미가 있으므로 통합 테스트는 실 DB 로 한다(R3).
- **테스트 DB**: 할당된 DB 는 `ABC11pioneer3` 하나다. `CREATE DATABASE` 권한 여부는 미확인이므로 다음 순서로 정한다.
  1. `db:check` 의 `SHOW GRANTS` 결과로 별도 DB(`ABC11pioneer3_test`) 생성이 가능하거나 DB 관리자가 내주면 → `DB_NAME_TEST` 로 지정(권장).
  2. 불가하면 → `DB_NAME_TEST=ABC11pioneer3` 를 허용하되 `ALLOW_TEST_ON_DEV_DB=1` 을 명시해야만 실행. 통합 테스트는 표식 데이터(`*@test.buildcare.local` 계정·`TEST-` 건물 코드)만 만들고 각 파일 종료 시 표식 기준으로 지운다. 개발 시드와 겹치지 않게 테스트 전에 시드 상태를 확인한다. 동시성 테스트(R6)는 이 모드에서도 실행하되 직렬로 돈다.
- **선행 조건**: 위 1·2 중 어느 쪽인지 단계 0 에서 확정한다.
- **Alternatives considered**: Jest(Vite 생태계와 설정 중복), Cypress(Playwright 가 다중 뷰포트·병렬에 유리).

## R21. 배포 (컨테이너 없음)

- **Decision**: GitLab CI 파이프라인은 `lint → test(unit) → test(integration, 테스트 DB) → build` 까지만 정의하고, 배포는 빌드 산출물(`frontend/dist`, `backend/dist`)을 서버에 복사해 pm2 로 재시작하는 스크립트 단계로 둔다. Nginx 는 `/` 정적 파일, `/api`·`/files` 백엔드 프록시, HTTPS 종단.
- **Rationale**: Intent-Plan 의 Nginx·GitLab CI/CD 는 유지하되 Docker 패키징만 사용자 지시로 뺐다. 현재 프로젝트는 git 저장소가 아니므로 CI 정의는 파일로만 준비한다.
- **Alternatives considered**: Docker 이미지 배포(배제), Vercel(원천 1단계 언급이나 Express 상주 프로세스·배치 작업과 맞지 않음).

## R22. 인증·권한 — RBAC + 건물 범위 판정 (2026-10-03 tasks 단계 추가 요구)

- **Decision**: 권한을 두 층으로 판정한다.
  1. **RBAC(무엇을 할 수 있나)** — 역할 → 권한(permission) 표. 역할은 업무 역할 5종(`user_role`, DDL) + 시스템 역할 `operator`(운영자) + 가상 역할 `guest`(비회원, `is_guest=TRUE`). 권한 코드는 `<영역>.<행동>` 형식(예 `analysis.create`, `record.create`, `verification.judge`, `priority.run`, `admin.users.manage`)으로 `backend/src/auth/permissions.ts` 에 카탈로그로 두고, 역할↔권한 배정은 DB `rbac_role_permission` 에 둔다(운영자가 매트릭스 화면에서 조정, 잠금 권한 제외).
  2. **범위(어디에 할 수 있나)** — 건물·기업 범위는 지금처럼 `v_access_check` 로만 판정(R5). 하자 건은 소유자 또는 건물 권한.
  - 미들웨어 순서: `authenticate → requirePermission(code) → requireBuildingAccess(kind) | requireCaseAccess`. 거부는 모두 **G0 GateBlock**(미로그인 401, 권한 없음 403) + `gate_event` 기록.
  - `GET /api/auth/me` 가 `roles` · `permissions` · `menu` 를 돌려주고, 프론트 라우터 `meta.permission` · `useCan()` 이 같은 코드를 쓴다(메뉴 = 권한에서 유도, FR-001).
- **002 확장(추가)**: `user_system_role(user_id, role_code CHECK IN ('operator'))` — DDL `chk_role_code` 가 5종만 허용하므로 별도 테이블 · `rbac_permission(permission_code, description, locked)` · `rbac_role_permission(role_code, permission_code)` · `rbac_audit_log(actor_id, action, target_user_id, detail_json, at)` · `auth_login_attempt(email, attempted_at, success)` · `idempotency_record(key, user_id, route, response_hash, created_at)` · `user_credential` 에 `token_version INT`, `disabled_at` 추가(우리 확장 테이블이므로 허용).
- **세션 무효화**: JWT 에는 `sub` 와 `tv`(token_version)만 싣고, 역할·권한은 요청마다 DB 에서 읽는다(60초 프로세스 캐시, 변경 시 즉시 무효화). 역할 변경·계정 비활성화·비밀번호 변경 시 `token_version+1` → 기존 세션 즉시 거부. R10 의 "역할을 토큰에 싣는다"를 이것으로 대체한다.
- **보호 장치**: 로그인 5회 연속 실패 시 15분 잠금(`auth_login_attempt`), 비밀번호 최소 10자, 권한 부여는 운영자(전 범위) · 기업 관리자(소속 조직 건물만) — 스펙 Assumptions "권한 부여자".
- **기본 매트릭스**(요약): guest = 분석 요청·본인 결과 · general = + 이용권·알림·권한 요청·비회원 연결 · facility = general + 건물 목록·기록·보수 결과 갱신·내 배정 · building = general + 건물 이력·동기화·일정 관리·위험 통지·전문가 요청 · enterprise = general + 건물 이력·대시보드·우선순위·소속 조직 권한 부여 · expert = 검증·자료 요청·신뢰도·요청 응답 · operator = 관리 전부.
- **Rationale**: 사용자 지시 "인증시스템(RBAC) 추가 구현". FR-001(역할별 메뉴)·FR-002(건물 단위 권한)·FR-003(권한 요청 처리)·FR-121(건물관리자만 연결)을 하나의 권한 표로 설명 가능하게 하고, 관리 API(`/api/admin/*`)의 주체(운영자)를 DDL 수정 없이 만든다.
- **Alternatives considered**: 역할 이름 하드코딩 `requireRole('building')`(역할 조합·운영 조정 불가, 메뉴와 API 판정이 갈라짐), DDL `chk_role_code` 에 operator 추가(DDL 수정 금지), 외부 IdP(원천 근거 없음).

## R23. 시연용 시드 데이터 — 스토리를 바로 체험할 수 있게

- **Decision**: `backend/src/db/seeds/` 에 `dev_constants.sql`(R17 기준값 + 시연 요금) + TypeScript 시드(`base.ts` 공통 · `stories/us1~us8.ts` · `stories/rbac.ts`)를 둔다. `npm run db:seed:dev [--reset] [--only=us3,us5]`.
  - **트리거 순서를 지킨다**: 시드는 SQL 을 직접 꽂지 않고 상태 전이 순서대로 넣는다(요청 `received → analyzing` 후 결과 삽입, 기록 `draft → saved`, 검증 대상은 트리거가 생성). 즉 시드 자체가 DB 규칙의 회귀 시험이 된다.
  - **상대 날짜**: 기한·가능일·구독 만료는 실행일 기준 상대값(어제·3일 후·30일 후)으로 넣어 언제 돌려도 지연·도래·만료 상태가 재현된다.
  - **사진**: `sharp` 로 결정적 합성 이미지(정상·어두움·흐림·저해상도)를 만들어 `STORAGE_DIR` 에 저장한다(외부 이미지 저작권·개인정보 없음).
  - **계정 비밀번호**: `SEED_DEMO_PASSWORD`(.env) 가 있으면 그것, 없으면 무작위 생성 후 실행 끝에 계정표와 함께 한 번 출력한다. 저장소·문서에 비밀번호를 적지 않는다.
  - **안전장치**: `NODE_ENV=production` 이면 거부, `--reset` 은 `SEED_ALLOW_RESET=1` 일 때만 업무 테이블을 FK 역순으로 비운다(기준 데이터·`schema_migration` 보존). 공유 DB(`ABC11pioneer3`)이므로 실행 전 대상 DB 이름을 출력한다.
  - **건물 유형**: DDL 기준 데이터는 `apartment` 뿐이다. 시연 다양성을 위해 **개발 시드에서만** `office` 를 추가한다(운영 DB 에는 넣지 않음).
- **Rationale**: 사용자 지시 "유저스토리를 경험가능한 시드데이터 생성". 각 스토리의 Independent Test 를 로그인 한 번으로 바로 재현하게 한다(quickstart §7).
- **Alternatives considered**: SQL 덤프(트리거 순서·상대 날짜 재현 불가), 테스트 픽스처 재사용만(시연 흐름과 목적이 다름).

---

## 미해결로 남기지 않은 항목의 처리 요약

| Technical Context 항목 | 처리 |
|---|---|
| DB 접속 정보 | R3 — 원격 MariaDB `mis.iptime.org:13306/ABC11pioneer3`, `.env` 주입. 확보됨, 실측은 단계 0 `db:check` |
| 테스트 DB | R20 — 별도 DB 우선, 불가 시 표식 데이터 모드 |
| 스키마 적용 수단 | R4 — Node 마이그레이션 러너 |
| AI 서비스·모델 | R7 — Gemini(`@google/genai`), 모델은 환경변수 |
| 결제 대행 | R11 — 어댑터 + Mock, 실제 PG 는 계약 후 추가 |
| 사진 저장 | R12 — 서버 디스크 + 서명 URL |
| 비회원 체험·계정 연결 | R9 · R10 |
| 배치 실행 | R13 — 프로세스 내 node-cron + DB 락 |
| 우선순위 산식 | R16 |
| 운영 기준값 | R17 |
| 건물관리시스템 | R15 |
| 인증·권한(RBAC) | R22 — 역할→권한 표 + `v_access_check` 범위 판정 |
| 시연 데이터 | R23 — 스토리별 시드, 트리거 순서·상대 날짜 |
