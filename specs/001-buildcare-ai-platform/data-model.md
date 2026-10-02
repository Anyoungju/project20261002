# Data Model — Buildcare AI

**Feature**: `001-buildcare-ai-platform` · **Date**: 2026-10-03 · **Plan**: [plan.md](./plan.md)

**정본(SoT)**: `Design/buildcare_ddl.sql`(SD_03, MariaDB 12.0 검증) — 이 문서는 구현자가 쓰기 쉽게 엔티티·관계·검증·상태 전이를 요약한다. 컬럼 타입·제약의 최종 판단은 DDL 을 따른다. 앱 운영 확장은 `backend/src/db/migrations/002_app_extensions.sql`(research R9)로 **추가만** 한다.

---

## 1. 영역과 엔티티

### H. 공통 코드·상수·고지 (기준 데이터)

| 엔티티 | 키 | 핵심 필드 | 규칙 |
|---|---|---|---|
| `gate_def` | gate_code (G0~G10) | gate_name, block_message, release_party | 게이트 차단 문구의 **단일 원천**. 프론트 C2·C3 문구는 이 값을 그대로 쓴다(FR-005) |
| `service_constant` | const_key | const_value(NULL 허용), unit | NULL = 보수적 동작(FR-110). 키: free_trial_count · pattern_min_records · due_soon_days · expert_response_hours · ai_low_confidence · expert_fee_rate · retention_days (+ R16 가중치 키) |
| `notice_text` | notice_id | notice_kind(analysis·priority·share), body, effective_from | 판본으로만 추가. 결과·우선순위·동의가 당시 판본을 FK 로 가리킨다(FR-018) |
| `defect_type_code` | code | crack·leak·condensation (+추가분 미정) | |
| `building_type_code` | code | apartment (+추가분 미정) | |

### A. 계정·조직·건물·권한

| 엔티티 | 키 | 핵심 필드 | 관계·규칙 |
|---|---|---|---|
| `organization` | org_id | org_name, license_expires_on | 만료일 경과 시 S6 진입을 G0 방식으로 차단(스펙 Assumptions) |
| `user_account` | user_id | email(UNIQUE), display_name, phone, org_id, **is_guest**(ext) | 화면은 `v_user_masked` 로만 조회(FR-090) |
| `user_role` | (user_id, role_code) | role_code ∈ general·facility·building·enterprise·expert | 다중 역할 가능 |
| `building` | building_id | org_id, building_name, building_type_code(NOT NULL), bms_ref | 건물 유형은 건물 속성 → 기록 화면 읽기 전용(FR-032) |
| `building_access` | (user_id, building_id, access_kind) | access_kind ∈ record·manage | 기업 관리자는 org 소속으로 자동 manage(`v_access_check`) |
| `permission_request` | perm_req_id | requester, building/org, requested_screen, resolution | G0 [권한 요청 보내기]. 처리 쌍 CHECK |
| `user_credential` *(ext)* | user_id | password_hash(bcrypt) | 비회원은 행 없음 |
| `guest_device` *(ext)* | device_id | token_hash(UNIQUE), guest_user_id, linked_user_id, linked_at | FR-120 · FR-120a |

### B. 이용권·결제

| 엔티티 | 키 | 핵심 필드 | 규칙 |
|---|---|---|---|
| `service_plan` | plan_code ∈ per_analysis·monthly | price_amount(NULL=미설정), analysis_quota, period_months | 형태 CHECK(건별=횟수, 월=기간) |
| `payment` | payment_id | user_id, plan_code, amount(시점 고정), pay_status, decline_reason, pg_tx_ref | declined ⇒ 사유 필수, 결정 ⇒ decided_at |
| `entitlement` | entitlement_id | user_id, ent_kind ∈ free_trial·per_analysis·monthly, payment_id(UNIQUE), quota_total, valid_until | 무료 체험만 결제 없음. 승인 결제만 유료 이용권(trg_entitlement_bi · G1). 잔여는 `v_entitlement_balance` 로 유도 |

### C. 하자 건·AI 분석

| 엔티티 | 키 | 핵심 필드 | 규칙 |
|---|---|---|---|
| `defect_case` | case_id | case_no(UNIQUE, 불변), owner_id, building_id(NULL=일반 사용자 건) | 진행의 축. 레일 = `v_case_progress` |
| `case_no_seq` *(ext)* | seq_year | last_no | `D-YYYY-NNNN` 발급(FOR UPDATE) |
| `analysis_request` | request_id | case_id, requester_id, entitlement_id, description(NULL 허용), req_status, quality_reject_reason | 상태 전이 §3-1. analyzing 진입 시 사진≥1·사용 가능 이용권(trg_request_bu) |
| `analysis_photo` | photo_id | request_id, storage_key, taken_at | |
| `analysis_result` | result_id | request_id(UNIQUE), notice_id(NOT NULL), risk_level, ai_confidence | **고지 없는 결과 불가**(FR-014). analyzing 요청에만 생성(trg_result_bi). 생성 시 요청 completed + 주의·위험이면 `risk_notice`(trg_result_ai) |
| `analysis_cause` | (result_id, cause_rank) | cause_text | 순위 ≥1 |
| `analysis_action` | (result_id, action_seq) | action_text | |

### D. 현장 이력

| 엔티티 | 키 | 핵심 필드 | 규칙 |
|---|---|---|---|
| `inspection_record` | record_id | case_id, building_id, recorder_id, result_id(NULL=신규 하자), location_text, defect_type_code, repair_status ∈ completed·pending, ai_match ∈ match·mismatch·none, record_status ∈ draft·saved | draft 로 시작(trg_record_bi). saved 전환 시 필수 항목 CHECK + 사진≥1(trg_record_bu · G5). saved→draft 불가. 불일치 저장 ⇒ `verification_item`(trg_record_au) |
| `record_photo` | photo_id | record_id, storage_key | 추가 시 열린 추가 자료 요청 자동 해소(trg_rphoto_ai) |
| `verification_item` | item_id | record_id(UNIQUE), result_id, item_status ∈ waiting·data_requested·verified | |
| `inspection_record_risk` *(ext)* | record_id | risk_flag, flagged_at | UC6 E3 "점검 결과 위험" → 일정 완료 시 위험 통지 |
| `record_repair_log` *(ext)* | log_id | record_id, old/new repair_status, changed_by, changed_at | 저장 후 보수 결과 갱신 이력 |

### E. 전문가·검증

| 엔티티 | 키 | 핵심 필드 | 규칙 |
|---|---|---|---|
| `expert_specialty` | (expert_id, specialty_code) | architecture·structure·waterproof | |
| `expert_availability` | (expert_id, available_on) | | 후보 검색 기준(FR-081) |
| `expert_verdict` | verdict_id | item_id, version_no(트리거 부여), verdict ∈ match·mismatch, opinion, diff_note, risk_high | 덮어쓰기 없음, 판본 누적(FR-042). 불일치 ⇒ diff_note. 열린 자료 요청 시 거부(trg_verdict_bi · G6). 저장 ⇒ item verified + risk_high 면 위험 통지 |
| `data_request` | data_req_id | item_id, expert_id, reason, sent_at, resolved_at | 판정 불가 = 판정이 아니라 자료 요청(FR-043). 신뢰도 지표 분모 제외 |

### F. 유지관리 계획·외부 이력·우선순위

| 엔티티 | 키 | 핵심 필드 | 규칙 |
|---|---|---|---|
| `inspection_schedule` | schedule_id | building_id, item_text, cycle_code, assignee_id, due_date, schedule_status ∈ scheduled·completed·cancelled, completed_record_id(UNIQUE) | 도래·지연은 저장하지 않고 `v_schedule_status` 로 유도. 완료 = 같은 건물 저장 기록 연결만(trg_schedule_bu) |
| `schedule_alert` | alert_id | schedule_id, alert_kind ∈ assigned·due·overdue, recipient_id, sent_at | 발송 사실 기록(FR-077) |
| `bms_sync_run` | sync_id | building_id, sync_status ∈ ok·failed, error_message | 최근 결과 = `v_building_sync_state` → C7 |
| `external_history` | ext_id | building_id, bms_record_ref, occurred_on, location_text, defect_type_code, summary | (building_id, bms_record_ref) UNIQUE — 중복 적재 방지 |
| `priority_run` | run_id | org_id, requested_by, period, notice_id(priority), external_included, excluded_building_count | 스냅숏, 재계산 없음(FR-065) |
| `priority_item` | (run_id, priority_rank) | building_id, location_text, defect_type_code, confidence_level ∈ normal·low, assigned_action ∈ inspection·expert | |
| `priority_item_basis` | basis_id | (run_id, rank), record_id XOR ext_id | 근거 역추적 ≥1(FR-064) — 앱이 삽입 시 보장 |

### G. 위험 통지·전문가 연결

| 엔티티 | 키 | 핵심 필드 | 규칙 |
|---|---|---|---|
| `risk_notice` | risk_notice_id | case_id, source_kind ∈ analysis·verdict·inspection + 배타 FK 1개, closed_at, close_reason ∈ connected·dismissed | 연결 확정 시 자동 종료(trg_connection_ai · FR-086) |
| `expert_request` | exp_req_id | case_id, building_id(NOT NULL — 건물관리자만, FR-121), requester_id, origin_kind, risk_notice_id, specialty_code, wish_from/to | 권고·통지 출처면 risk_notice_id 필수. 상태 = `v_expert_request_status` |
| `share_consent` | consent_id | exp_req_id, expert_id, scope_text(고정), notice_id(share), consented_by/at | 전문가 1명 한정(FR-083) |
| `expert_request_attempt` | attempt_id | (consent_id, exp_req_id, expert_id) 복합 FK, response ∈ accepted·declined·no_response | 동의 없이 시도 불가(G9) |
| `expert_connection` | connection_id | attempt_id(UNIQUE), fee_amount(NULL=요율 미설정), confirmed_at | 수락 시도만(trg_connection_bi · G10) |

### H'. 게이트 이벤트·알림·운영

| 엔티티 | 키 | 핵심 필드 | 규칙 |
|---|---|---|---|
| `gate_event` | event_id | gate_code, actor_id, subject_kind/id, reason_text, released_at/by, release_action | 발생·해제 이력(FR-007). 앱이 게이트 응답 시 기록 |
| `notification` *(ext)* | notif_id | recipient_id, kind, ref_kind/id, title, read_at | 서비스 내 알림 |
| `photo_quality_rule` *(ext)* | rule_key | threshold, reason_text | G3 기준(research R8) |
| `schema_migration` *(ext)* | filename | checksum, applied_at | |

### I. 인증·RBAC 확장 *(ext, research R22 — 002_app_extensions.sql · 003_rbac_seed.sql)*

| 엔티티 | 키 | 핵심 필드 | 규칙 |
|---|---|---|---|
| `user_credential` | user_id | password_hash, **token_version**, must_change_password, disabled_at | JWT 의 `tv` 와 다르면 세션 거부 → 역할 변경·비활성화·비밀번호 변경 즉시 반영 |
| `user_system_role` | (user_id, role_code) | role_code ∈ operator | DDL `chk_role_code`(업무 5종)를 바꾸지 않고 운영자 역할을 둔다 |
| `rbac_permission` | permission_code | description, locked | 카탈로그 = `backend/src/auth/permissions.ts` (기동 시 대조) |
| `rbac_role_permission` | (role_code, permission_code) | role_code ∈ guest·general·facility·building·enterprise·expert·operator | 운영자가 매트릭스 화면에서 조정. locked 권한은 운영자에게서 제거 불가 |
| `rbac_audit_log` | audit_id | actor_id, action, target_user_id, detail_json, at | 계정·역할·건물 권한·권한 요청·매트릭스·기준값·고지 변경 감사 |
| `auth_login_attempt` | attempt_id | email, success, attempted_at | 5회 연속 실패 → 15분 잠금(423) |
| `idempotency_record` | (idem_key, user_scope, route) | status_code, response_body | R14 중복 제출 방지(결제·분석 요청·기록 저장·요청 확정) |

판정 순서: `requirePermission(권한 코드)` → `v_access_check`(건물·기업 범위) → 업무 규칙(뷰·트리거). 거부는 모두 G0 GateBlock(+ `gate_event`).

---

## 2. 관계 요약

```text
organization 1─* user_account 1─* user_role
organization 1─* building 1─* building_access *─1 user_account
user_account 1─* payment 1─0..1 entitlement
user_account 1─* defect_case 1─* analysis_request 1─* analysis_photo
                                analysis_request 1─0..1 analysis_result 1─* analysis_cause / analysis_action
defect_case 1─* inspection_record 1─* record_photo
inspection_record 0..1─1 verification_item 1─* expert_verdict (판본) / data_request
building 1─* inspection_schedule 1─* schedule_alert ; inspection_schedule 0..1─1 inspection_record (완료 근거)
building 1─* bms_sync_run 1─* external_history
organization 1─* priority_run 1─* priority_item 1─* priority_item_basis ─(record | external)
defect_case 1─* risk_notice ─(analysis_result | expert_verdict | inspection_schedule)
defect_case 1─* expert_request 1─* share_consent 1─0..1 expert_request_attempt 1─0..1 expert_connection
```

---

## 3. 상태 전이

### 3-1 분석 요청 `analysis_request.req_status`

```text
received ──품질 부적합(G3)──▶ quality_rejected        (이용권 미소진, AI 미호출)
received ──이용권 확보(G2)──▶ analyzing               (FOR UPDATE + trg_request_bu)
analyzing ─AI 정상──▶ [analysis_result 삽입] ──▶ completed (trg_result_ai)
analyzing ─AI 실패·타임아웃(G4)──▶ failed             (이용권 미소진 — 뷰가 failed 를 세지 않음)
failed ──[다시 분석 요청]──▶ 새 analysis_request(같은 case, 같은 사진 복사)
```

### 3-2 현장 기록 `inspection_record.record_status`

```text
(생성) draft ──필수 항목 + 사진≥1──▶ saved ──(불일치)──▶ verification_item 생성
draft ──사진 저장 실패──▶ draft 유지(텍스트 임시 저장, 집계·검증·일정 완료 제외)
saved ──repair_status 갱신만 허용(pending→completed, record_repair_log)
saved ──▶ draft  ✗ (trg_record_bu 거부)
```

### 3-3 검증 대상 `verification_item.item_status`

```text
waiting ──판정 저장──▶ verified ──재판정──▶ verified (판본 +1)
waiting ──판정 불가(data_request, sent_at)──▶ data_requested
data_requested ──record_photo 추가(trg_rphoto_ai → trg_datareq_au)──▶ waiting
data_requested ──판정 저장 시도──▶ ✗ (G6)
```

### 3-4 정기점검 일정 (저장 상태 + 표시 상태)

```text
저장: scheduled ──기록 연결──▶ completed | scheduled ──취소──▶ cancelled
표시(v_schedule_status): scheduled → due(due_soon_days 이내, 값 없으면 생략) → overdue(due_date 경과)
overdue 최초 감지 시 schedule_alert(overdue) + notification(담당자) + 건물관리자 화면 표시
```

### 3-5 결제 `payment.pay_status`

```text
requested ──PG 승인 확인──▶ approved ──▶ entitlement 1건 (UNIQUE)
requested ──PG 거절──▶ declined(사유 필수, G1)
```

### 3-6 전문가 요청 (유도 상태 `v_expert_request_status`)

```text
drafting ──동의(share_consent)+시도(attempt)──▶ awaiting
awaiting ──accepted──▶ connected (expert_connection, 위험 통지 종료)
awaiting ──declined | no_response(시한 경과, 값 있을 때만)──▶ not_confirmed ──다른 후보 동의+시도──▶ awaiting
(어느 상태든) closed_at 설정 ──▶ closed
```

### 3-7 위험 통지 `risk_notice`

```text
open(closed_at NULL) ──연결 확정──▶ closed(connected)
open ──건물관리자 [조치 없음 종료]──▶ closed(dismissed)
```

---

## 4. 검증 규칙 ↔ 요구사항 사상

| 요구사항 | 강제 지점 | 앱 측 추가 처리 |
|---|---|---|
| FR-010 사진 1장 이상 | trg_request_bu (BR-DEF-03) | 업로드 0장이면 422 |
| FR-011 · G2 이용권 | v_analysis_eligibility · trg_request_bu | FOR UPDATE 로 동시성 제어(R6), 402 + gate 블록 |
| FR-012 · G3 품질 | 앱(sharp) → req_status quality_rejected + chk_req_reject_reason | AI 미호출, 422 |
| FR-013 · G4 AI 실패 | trg_result_bi(analyzing 에만 결과) | failed 기록, 502 + gate 블록 |
| FR-014 · FR-018 고지 | analysis_result.notice_id NOT NULL FK | 현재 판본 notice_id 삽입, 응답에 판본 본문 포함 |
| FR-015 · FR-016 위험 권고·통지 | trg_result_ai | ai_low_confidence 로 위험도 상향(R7) |
| FR-017 소진 | v_entitlement_balance(analyzing·completed 만 계수) | — |
| FR-021 · FR-022 결제 | trg_entitlement_bi · uq_entitlement_payment · chk_pay_* | 서버 측 PG confirm, Idempotency-Key |
| FR-024 구독 만료 | v_entitlement_balance valid_until | — |
| FR-033 · G5 필수 항목 | chk_rec_required_on_save · trg_record_bu | 저장 전 앱 검증으로 누락 목록 반환(422) |
| FR-034 보수 결과 갱신·되돌림 금지 | trg_record_bu | record_repair_log 기록 |
| FR-036 불일치 자동 검증 대상 | trg_record_au | — |
| FR-042 판본 | uq_verdict_version · trg_verdict_bi | — |
| FR-043 · FR-044 · G6 | data_request · trg_verdict_bi · trg_rphoto_ai · trg_datareq_* | 409 + gate 블록 |
| FR-045 신뢰도 지표 | v_ai_trust_metric(판정 불가 제외) | — |
| FR-052 외부 이력 중복 | uq_ext_ref | upsert |
| FR-053 · G7 | v_repeat_defect · v_pattern_gate | 미통과 시 패턴 미반환 |
| FR-063 권한 밖 제외 | v_access_check | excluded_building_count 기록 |
| FR-064 근거 역추적 | priority_item_basis chk_basis_one | 항목마다 basis ≥1 삽입 확인 |
| FR-065 스냅숏 | priority_run/item 불변 | UPDATE 는 assigned_action 만 허용 |
| FR-073 일정 완료 | chk_sched_completed · trg_schedule_bu · uq_schedule_record | — |
| FR-082 · FR-083 · G9 | share_consent + 복합 FK attempt | 동의 없으면 409 |
| FR-085 · G10 수수료 | trg_connection_bi · fee_amount | 확정 시점 요율 계산, 미설정이면 NULL |
| FR-086 통지 종료 | trg_connection_ai | — |
| FR-090 마스킹 | v_user_masked | 응답 직렬화는 마스킹 필드만 |
| FR-092 반출 감사 | share_consent · expert_request_attempt (불변) | UPDATE·DELETE 경로 없음 |
| FR-093 자동 삭제 없음 | retention_days NULL | 삭제 배치 미구현 |
| FR-120 · FR-120a · FR-120b | guest_device · is_guest | 연결 전 비회원 건은 building_id NULL 이라 기록·검증·이력에 연결되지 않음 |
| FR-121 건물관리자만 연결 | expert_request.building_id NOT NULL | `requirePermission('expert_request.create')`(building 역할만 보유) + manage 권한 |
| FR-001 역할별 메뉴 | rbac_role_permission | `GET /api/auth/me` 의 menu = 권한에서 유도(SCREEN_PERMISSIONS) |
| FR-002 건물·기업 범위 | v_access_check | `requireBuildingAccess(record\|manage)` |
| FR-003 권한 요청·처리 기록 | permission_request · rbac_audit_log | 승인 시 같은 트랜잭션에서 building_access + G0 해제 기록 |

---

## 5. 앱 작성 규약 (SD_03 §16-5 승계)

1. 판정은 뷰로만 한다 — G0 · G2 · G7 · 일정 상태 · 요청 상태를 코드에서 재계산하지 않는다.
2. 트리거가 갱신하는 테이블을 같은 문장에서 읽지 않는다(ERROR 1442). `data_request`·`expert_verdict` 는 `item_id` 를 값으로 넘긴다.
3. 트리거 `SIGNAL 45000` 메시지 접두어 → 게이트 코드 사상은 `backend/src/gates/sqlErrorMap.ts` 한 곳에서만 한다.
4. 기준 데이터(gate_def · notice_text · 코드)는 마이그레이션·관리 API 로만 바꾼다. 고지 문구 변경 = 새 판본 INSERT.
