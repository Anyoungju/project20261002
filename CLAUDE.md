# project261002 Development Guidelines

Buildcare AI — 건축물 하자 사진 AI 분석·유지관리 플랫폼. Last updated: 2026-10-03

## Active Technologies
<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
- TypeScript 5.x · Node.js 20 LTS · Express 4.x · mysql2 3.x (001-buildcare-ai-platform)
- Vue 3.4+ (Composition API) · Vite 5.x · Pinia 2.x · Vue Router 4.x (001-buildcare-ai-platform)
- 원격 MariaDB ≥10.6 — `mis.iptime.org:13306` / `ABC11pioneer3`, 접속 정보는 `backend/.env` 만 (001-buildcare-ai-platform)
- @google/genai (Gemini) · sharp · node-cron · nodemailer · Vitest · Supertest · Playwright (001-buildcare-ai-platform)

## Project Structure

```text
backend/    Express API — src/modules/<P0~P8 도메인>, src/db/migrations, src/adapters, src/jobs
frontend/   Vue SPA — src/views/<S1~S8B>, src/components/common/<C1~C8>
Design/     설계서 (UC · SD_01 프로세스 · SD_02 UI/UX · SD_03 DB · buildcare_ddl.sql · 스타일가이드.html)
specs/001-buildcare-ai-platform/   spec · plan · research · data-model · contracts/openapi.yaml · quickstart
```

## Commands

```bash
cd backend  && npm run db:check && npm run db:migrate && npm run db:seed:dev -- --reset
cd backend  && npm run lint && npm test && npm run test:integration      # 단위 35 · 통합 77 (원격 DB, 표식 데이터)
cd frontend && npm run lint && npm run check:style && npm test
cd frontend && BASE_URL=https://p3.sumzip.com npm run test:e2e           # Playwright 34
cd backend && npm run build && cd ../frontend && npm run build && cd .. && pm2 restart buildcare   # 운영 p3.sumzip.com → :9503
```

## Code Style / Rules

- Docker 를 쓰지 않는다. MariaDB 외 DB·Homebrew DB·SQLite 대체를 쓰지 않는다.
- DB 접속은 Node 스크립트(`npm run db:check`·`db:migrate`)로만. `docker exec`·`mysql` 터미널 클라이언트를 쓰지 않는다. 비밀번호는 `.env` 외에 적지 않는다.
- `Design/buildcare_ddl.sql` 은 수정하지 않는다. 확장은 `002_app_extensions.sql` 에 추가만 한다.
- 게이트·상태 판정은 DB 뷰(v_access_check · v_analysis_eligibility · v_pattern_gate · v_schedule_status · v_expert_request_status)로만 한다. 코드에서 재계산하지 않는다.
- 트리거 SIGNAL → 게이트 사상은 `backend/src/gates/sqlErrorMap.ts` 한 곳에서만.
- 트리거가 갱신하는 테이블을 같은 SQL 문에서 읽지 않는다(MariaDB ERROR 1442).
- 게이트 미통과는 `GateBlock` 응답 → C2 차단 블록. 토스트·모달 금지. 문구는 gate_def 단일 원천.
- AI 분석 결과·우선순위는 고지(notice_text 판본) 없이 만들거나 표시하지 않는다.
- 개인정보는 `v_user_masked` 마스킹 필드로만 응답한다.
- 인가는 `requirePermission(<권한 코드>)`(RBAC, `backend/src/auth/permissions.ts`) + `requireBuildingAccess`(`v_access_check`) 두 층으로만. 역할 이름으로 분기하지 않는다(research R22).
- 시드는 트리거 순서대로 넣고 날짜는 실행일 기준 상대값. 시드 계정 비밀번호는 `SEED_DEMO_PASSWORD` 로만(research R23).

## Recent Changes

- 001-buildcare-ai-platform: 계획 수립 — Vue 3 + Express + 원격 MariaDB, 컨테이너 없음
