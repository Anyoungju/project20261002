-- =====================================================================
-- Buildcare AI - SD_03 데이터베이스 DDL
-- 문서: Design/SD_03_데이터베이스설계서_Buildcare AI.md
-- 입력: SD_02 UI/UX 설계서 · SD_01 프로세스 설계서 · UC_01~UC_08
--
-- 표준 SQL 을 기준으로 쓰고, 검증 DBMS 는 MariaDB 12.0 이다.
-- 표준에서 벗어난 구문은 아래와 같으며 이유를 함께 적는다.
--   [M1] AUTO_INCREMENT     : MariaDB 는 GENERATED AS IDENTITY 를 지원하지 않는다.
--   [M2] IF NOT EXISTS      : 멱등 실행용. 표준 DDL 에는 없으나 주요 DBMS 공통.
--   [M3] DELIMITER //       : mariadb 클라이언트 지시어. 트리거 본문의 ';' 때문에 필요.
--   [M4] SIGNAL SQLSTATE    : SQL/PSM 표준 구문. MariaDB 트리거에서 위반을 거부하는 수단.
--   [M5] DATE_ADD · SUBSTRING_INDEX · CAST AS SIGNED : MariaDB 함수. 해당 뷰에 표기.
--   [M6] CREATE OR REPLACE VIEW : 멱등 실행용.
-- 실행 중 확인한 이탈 사항:
--   [X1] MariaDB ERROR 1442 — 트리거가 갱신하는 테이블(verification_item)을 호출 문장이 읽으면 거부된다.
--        data_request · expert_verdict 는 INSERT ... SELECT FROM verification_item 대신 item_id 값을 넘겨 넣는다.
--        (논리 설계 변경 없음. 애플리케이션 작성 규약으로 SD_03 §무결성에 기록)
--   [X2] 같은 이유로 trg_rphoto_ai 는 item_id 를 변수로 먼저 읽고 data_request 를 갱신한다.
-- 실행: mariadb <db명> < buildcare_ddl.sql   (재실행 가능)
-- 생성 순서: FK 의존 위상 정렬 (참조되는 테이블이 먼저)
-- =====================================================================

-- ---------------------------------------------------------------------
-- H. 공통 코드·상수·고지 판본  (다른 영역이 참조하므로 먼저 만든다)
-- ---------------------------------------------------------------------

-- SD_01 §13 게이트 정의. block_message 는 SD_02 §12 사상 규칙 ④(두 화면 동일 문구)의 단일 원천
CREATE TABLE IF NOT EXISTS gate_def (
  gate_code      VARCHAR(4)   NOT NULL,
  gate_name      VARCHAR(100) NOT NULL,
  block_message  VARCHAR(200) NOT NULL,
  release_party  VARCHAR(100) NOT NULL,
  CONSTRAINT pk_gate_def PRIMARY KEY (gate_code)
);

-- 원천에 값이 없는 임계값·기준. 키는 두고 값은 비운다(§미해결). 값이 NULL 이면 관련 판정은 보수적으로 동작한다
CREATE TABLE IF NOT EXISTS service_constant (
  const_key    VARCHAR(50)  NOT NULL,
  const_value  VARCHAR(100) NULL,
  unit         VARCHAR(20)  NULL,
  description  VARCHAR(200) NOT NULL,
  CONSTRAINT pk_service_constant PRIMARY KEY (const_key)
);

-- C4 1차 참고용 고지·확정 전 고지 문구의 판본. 결과는 표시 당시 판본을 참조한다(BR-DEF-01 · BR-DEF-11)
CREATE TABLE IF NOT EXISTS notice_text (
  notice_id       BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  notice_kind     VARCHAR(20)  NOT NULL,
  body            VARCHAR(1000) NOT NULL,
  effective_from  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_notice_text PRIMARY KEY (notice_id),
  CONSTRAINT uq_notice_text_kind UNIQUE (notice_id, notice_kind),
  CONSTRAINT chk_notice_kind CHECK (notice_kind IN ('analysis','priority','share'))
);

CREATE TABLE IF NOT EXISTS defect_type_code (
  defect_type_code  VARCHAR(20) NOT NULL,
  defect_type_name  VARCHAR(50) NOT NULL,
  CONSTRAINT pk_defect_type_code PRIMARY KEY (defect_type_code)
);

CREATE TABLE IF NOT EXISTS building_type_code (
  building_type_code  VARCHAR(20) NOT NULL,
  building_type_name  VARCHAR(50) NOT NULL,
  CONSTRAINT pk_building_type_code PRIMARY KEY (building_type_code)
);

-- ---------------------------------------------------------------------
-- A. 계정·조직·건물·권한
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organization (
  org_id              BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  org_name            VARCHAR(100) NOT NULL,
  license_expires_on  DATE         NULL,     -- UC8 사전조건 2. 검증 방식 미정 → 값 비움 허용
  CONSTRAINT pk_organization PRIMARY KEY (org_id)
);

CREATE TABLE IF NOT EXISTS user_account (
  user_id       BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  email         VARCHAR(255) NOT NULL,
  display_name  VARCHAR(50)  NOT NULL,
  phone         VARCHAR(20)  NULL,
  org_id        BIGINT       NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_user_account PRIMARY KEY (user_id),
  CONSTRAINT uq_user_email UNIQUE (email),
  CONSTRAINT fk_user_org FOREIGN KEY (org_id) REFERENCES organization (org_id)
);

-- UC_00 §4 Actor 카탈로그의 Primary 액터 5종
CREATE TABLE IF NOT EXISTS user_role (
  user_id    BIGINT      NOT NULL,
  role_code  VARCHAR(20) NOT NULL,
  CONSTRAINT pk_user_role PRIMARY KEY (user_id, role_code),
  CONSTRAINT fk_user_role_user FOREIGN KEY (user_id) REFERENCES user_account (user_id),
  CONSTRAINT chk_role_code CHECK (role_code IN ('general','facility','building','enterprise','expert'))
);

-- BR-DEF-06: 건물 유형은 건물의 속성이며 이력 레코드는 building_id 로 이를 필수 포함한다
CREATE TABLE IF NOT EXISTS building (
  building_id         BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  org_id              BIGINT       NULL,
  building_name       VARCHAR(100) NOT NULL,
  building_type_code  VARCHAR(20)  NOT NULL,
  bms_ref             VARCHAR(100) NULL,     -- 건물관리시스템 연계 키 (UC5 사전조건 4)
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_building PRIMARY KEY (building_id),
  CONSTRAINT fk_building_org  FOREIGN KEY (org_id) REFERENCES organization (org_id),
  CONSTRAINT fk_building_type FOREIGN KEY (building_type_code) REFERENCES building_type_code (building_type_code)
);

-- BR-DEF-08 / G0: 건물 단위 권한. 기업 관리자는 org 소속으로 판정(v_access_check)
CREATE TABLE IF NOT EXISTS building_access (
  user_id      BIGINT      NOT NULL,
  building_id  BIGINT      NOT NULL,
  access_kind  VARCHAR(10) NOT NULL,
  granted_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_building_access PRIMARY KEY (user_id, building_id, access_kind),
  CONSTRAINT fk_access_user     FOREIGN KEY (user_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_access_building FOREIGN KEY (building_id) REFERENCES building (building_id),
  CONSTRAINT chk_access_kind CHECK (access_kind IN ('record','manage'))
);

-- G0 해제 액션 [권한 요청 보내기]. 수신자는 미정(§미해결) → 처리자만 기록
CREATE TABLE IF NOT EXISTS permission_request (
  perm_req_id       BIGINT      NOT NULL AUTO_INCREMENT,   -- [M1]
  requester_id      BIGINT      NOT NULL,
  building_id       BIGINT      NULL,
  org_id            BIGINT      NULL,
  requested_screen  VARCHAR(10) NOT NULL,
  requested_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolution        VARCHAR(10) NULL,
  resolved_by       BIGINT      NULL,
  resolved_at       TIMESTAMP   NULL,
  CONSTRAINT pk_permission_request PRIMARY KEY (perm_req_id),
  CONSTRAINT fk_permreq_requester FOREIGN KEY (requester_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_permreq_building  FOREIGN KEY (building_id) REFERENCES building (building_id),
  CONSTRAINT fk_permreq_org       FOREIGN KEY (org_id) REFERENCES organization (org_id),
  CONSTRAINT fk_permreq_resolver  FOREIGN KEY (resolved_by) REFERENCES user_account (user_id),
  CONSTRAINT chk_permreq_resolution CHECK (resolution IS NULL OR resolution IN ('granted','rejected')),
  CONSTRAINT chk_permreq_resolved_pair CHECK (
    (resolution IS NULL AND resolved_at IS NULL AND resolved_by IS NULL) OR
    (resolution IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);

-- ---------------------------------------------------------------------
-- B. 이용권·결제
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS service_plan (
  plan_code      VARCHAR(20)   NOT NULL,
  plan_name      VARCHAR(50)   NOT NULL,
  price_amount   DECIMAL(12,0) NULL,   -- 금액 미정(§미해결)
  analysis_quota INT           NULL,
  period_months  INT           NULL,
  CONSTRAINT pk_service_plan PRIMARY KEY (plan_code),
  CONSTRAINT chk_plan_code CHECK (plan_code IN ('per_analysis','monthly')),
  -- BR-DEF-05: 건별 유료 분석은 횟수, 월 구독은 기간으로 이용한다
  CONSTRAINT chk_plan_shape CHECK (
    (plan_code = 'per_analysis' AND analysis_quota IS NOT NULL AND period_months IS NULL) OR
    (plan_code = 'monthly' AND period_months IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS payment (
  payment_id      BIGINT        NOT NULL AUTO_INCREMENT,   -- [M1]
  user_id         BIGINT        NOT NULL,
  plan_code       VARCHAR(20)   NOT NULL,
  amount          DECIMAL(12,0) NULL,    -- 유도인데 저장: 결제 시점 요금 고정
  pay_status      VARCHAR(10)   NOT NULL DEFAULT 'requested',
  decline_reason  VARCHAR(200)  NULL,
  pg_tx_ref       VARCHAR(100)  NULL,
  requested_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at      TIMESTAMP     NULL,
  CONSTRAINT pk_payment PRIMARY KEY (payment_id),
  CONSTRAINT fk_payment_user FOREIGN KEY (user_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_payment_plan FOREIGN KEY (plan_code) REFERENCES service_plan (plan_code),
  CONSTRAINT chk_pay_status CHECK (pay_status IN ('requested','approved','declined')),
  -- G1: 거절에는 사유가 있다 (SD_02 S1 "사유: 결제 수단 거절")
  CONSTRAINT chk_pay_declined_reason CHECK (pay_status <> 'declined' OR decline_reason IS NOT NULL),
  CONSTRAINT chk_pay_decided_at CHECK (pay_status = 'requested' OR decided_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS entitlement (
  entitlement_id  BIGINT      NOT NULL AUTO_INCREMENT,   -- [M1]
  user_id         BIGINT      NOT NULL,
  ent_kind        VARCHAR(20) NOT NULL,
  payment_id      BIGINT      NULL,
  quota_total     INT         NULL,
  valid_from      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until     TIMESTAMP   NULL,
  CONSTRAINT pk_entitlement PRIMARY KEY (entitlement_id),
  CONSTRAINT uq_entitlement_payment UNIQUE (payment_id),
  CONSTRAINT fk_ent_user    FOREIGN KEY (user_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_ent_payment FOREIGN KEY (payment_id) REFERENCES payment (payment_id),
  CONSTRAINT chk_ent_kind CHECK (ent_kind IN ('free_trial','per_analysis','monthly')),
  -- BR-DEF-05: 무료 체험만 결제 없이 생긴다
  CONSTRAINT chk_ent_payment CHECK (
    (ent_kind = 'free_trial' AND payment_id IS NULL) OR
    (ent_kind <> 'free_trial' AND payment_id IS NOT NULL)),
  CONSTRAINT chk_ent_quota  CHECK (ent_kind = 'monthly' OR quota_total IS NOT NULL),
  CONSTRAINT chk_ent_period CHECK (ent_kind <> 'monthly' OR valid_until IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- C. 하자 건·AI 분석
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS defect_case (
  case_id      BIGINT      NOT NULL AUTO_INCREMENT,   -- [M1]
  case_no      VARCHAR(20) NOT NULL,   -- 유도인데 저장: 화면 식별 번호(D-2026-0142). 발급 후 불변
  owner_id     BIGINT      NOT NULL,
  building_id  BIGINT      NULL,       -- 일반 사용자 건은 건물 없음 → 레일 2·3 "해당 없음"
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_defect_case PRIMARY KEY (case_id),
  CONSTRAINT uq_case_no UNIQUE (case_no),
  CONSTRAINT fk_case_owner    FOREIGN KEY (owner_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_case_building FOREIGN KEY (building_id) REFERENCES building (building_id)
);

CREATE TABLE IF NOT EXISTS analysis_request (
  request_id             BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  case_id                BIGINT       NOT NULL,
  requester_id           BIGINT       NOT NULL,
  entitlement_id         BIGINT       NULL,
  description            VARCHAR(500) NULL,    -- UC1 A2 설명 필수 여부 미정 → NULL 허용
  req_status             VARCHAR(20)  NOT NULL DEFAULT 'received',
  quality_reject_reason  VARCHAR(200) NULL,
  requested_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_analysis_request PRIMARY KEY (request_id),
  CONSTRAINT fk_req_case      FOREIGN KEY (case_id) REFERENCES defect_case (case_id),
  CONSTRAINT fk_req_requester FOREIGN KEY (requester_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_req_ent       FOREIGN KEY (entitlement_id) REFERENCES entitlement (entitlement_id),
  CONSTRAINT chk_req_status CHECK (req_status IN ('received','quality_rejected','analyzing','failed','completed')),
  -- G3 / BR-DEF-04: 품질 부적합에는 사유가 있다
  CONSTRAINT chk_req_reject_reason CHECK (req_status <> 'quality_rejected' OR quality_reject_reason IS NOT NULL),
  -- G2 / BR-DEF-05: 이용권 없이 분석 단계로 갈 수 없다
  CONSTRAINT chk_req_entitlement CHECK (req_status IN ('received','quality_rejected') OR entitlement_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS analysis_photo (
  photo_id     BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  request_id   BIGINT       NOT NULL,
  storage_key  VARCHAR(300) NOT NULL,
  taken_at     TIMESTAMP    NULL,
  uploaded_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_analysis_photo PRIMARY KEY (photo_id),
  CONSTRAINT fk_aphoto_req FOREIGN KEY (request_id) REFERENCES analysis_request (request_id)
);

CREATE TABLE IF NOT EXISTS analysis_result (
  result_id      BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  request_id     BIGINT       NOT NULL,
  notice_id      BIGINT       NOT NULL,   -- BR-DEF-01: 고지 없는 결과는 존재할 수 없다
  notice_kind    VARCHAR(20)  NOT NULL DEFAULT 'analysis',
  risk_level     VARCHAR(10)  NOT NULL,   -- 유도인데 저장: 판정 시점 고정(EXT1 · E3)
  ai_confidence  DECIMAL(4,3) NULL,
  completed_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_analysis_result PRIMARY KEY (result_id),
  CONSTRAINT uq_result_request UNIQUE (request_id),
  CONSTRAINT fk_result_req    FOREIGN KEY (request_id) REFERENCES analysis_request (request_id),
  CONSTRAINT fk_result_notice FOREIGN KEY (notice_id, notice_kind) REFERENCES notice_text (notice_id, notice_kind),
  CONSTRAINT chk_result_notice_kind CHECK (notice_kind = 'analysis'),
  CONSTRAINT chk_result_risk CHECK (risk_level IN ('normal','caution','danger')),
  CONSTRAINT chk_result_conf CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1))
);

CREATE TABLE IF NOT EXISTS analysis_cause (
  result_id   BIGINT       NOT NULL,
  cause_rank  SMALLINT     NOT NULL,
  cause_text  VARCHAR(300) NOT NULL,
  CONSTRAINT pk_analysis_cause PRIMARY KEY (result_id, cause_rank),
  CONSTRAINT fk_cause_result FOREIGN KEY (result_id) REFERENCES analysis_result (result_id),
  CONSTRAINT chk_cause_rank CHECK (cause_rank >= 1)
);

CREATE TABLE IF NOT EXISTS analysis_action (
  result_id    BIGINT       NOT NULL,
  action_seq   SMALLINT     NOT NULL,
  action_text  VARCHAR(500) NOT NULL,
  CONSTRAINT pk_analysis_action PRIMARY KEY (result_id, action_seq),
  CONSTRAINT fk_action_result FOREIGN KEY (result_id) REFERENCES analysis_result (result_id),
  CONSTRAINT chk_action_seq CHECK (action_seq >= 1)
);

-- ---------------------------------------------------------------------
-- D. 현장 이력
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inspection_record (
  record_id         BIGINT        NOT NULL AUTO_INCREMENT,   -- [M1]
  case_id           BIGINT        NOT NULL,
  building_id       BIGINT        NOT NULL,
  recorder_id       BIGINT        NOT NULL,
  result_id         BIGINT        NULL,     -- UC3 A2 신규 하자는 연결 없음
  location_text     VARCHAR(200)  NULL,
  defect_type_code  VARCHAR(20)   NULL,
  repair_status     VARCHAR(10)   NULL,     -- 'pending' = 미완료 - 보수 예정 (명시값, UC3 A1)
  repair_method     VARCHAR(200)  NULL,
  inspection_note   VARCHAR(1000) NULL,
  ai_match          VARCHAR(10)   NULL,
  record_status     VARCHAR(10)   NOT NULL DEFAULT 'draft',
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  saved_at          TIMESTAMP     NULL,
  CONSTRAINT pk_inspection_record PRIMARY KEY (record_id),
  CONSTRAINT fk_rec_case     FOREIGN KEY (case_id) REFERENCES defect_case (case_id),
  CONSTRAINT fk_rec_building FOREIGN KEY (building_id) REFERENCES building (building_id),
  CONSTRAINT fk_rec_recorder FOREIGN KEY (recorder_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_rec_result   FOREIGN KEY (result_id) REFERENCES analysis_result (result_id),
  CONSTRAINT fk_rec_defect   FOREIGN KEY (defect_type_code) REFERENCES defect_type_code (defect_type_code),
  CONSTRAINT chk_rec_repair_status CHECK (repair_status IS NULL OR repair_status IN ('completed','pending')),
  CONSTRAINT chk_rec_ai_match CHECK (ai_match IS NULL OR ai_match IN ('match','mismatch','none')),
  CONSTRAINT chk_rec_status CHECK (record_status IN ('draft','saved')),
  -- BR-DEF-06 / G5: 저장된 레코드는 위치·하자 종류·보수 결과를 반드시 가진다 (건물 유형은 building 에서 NOT NULL)
  CONSTRAINT chk_rec_required_on_save CHECK (
    record_status = 'draft' OR
    (location_text IS NOT NULL AND defect_type_code IS NOT NULL AND repair_status IS NOT NULL
     AND ai_match IS NOT NULL AND saved_at IS NOT NULL)),
  -- 연결된 분석 결과가 없으면 비교 대상도 없다
  CONSTRAINT chk_rec_match_link CHECK (
    ai_match IS NULL OR
    (result_id IS NULL AND ai_match = 'none') OR
    (result_id IS NOT NULL AND ai_match IN ('match','mismatch')))
);

CREATE TABLE IF NOT EXISTS record_photo (
  photo_id     BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  record_id    BIGINT       NOT NULL,
  storage_key  VARCHAR(300) NOT NULL,
  uploaded_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_record_photo PRIMARY KEY (photo_id),
  CONSTRAINT fk_rphoto_rec FOREIGN KEY (record_id) REFERENCES inspection_record (record_id)
);

-- BR-DEF-07: 불일치 레코드는 검증 대상이 된다 (trg_record_au 가 생성)
CREATE TABLE IF NOT EXISTS verification_item (
  item_id      BIGINT      NOT NULL AUTO_INCREMENT,   -- [M1]
  record_id    BIGINT      NOT NULL,
  result_id    BIGINT      NOT NULL,
  item_status  VARCHAR(20) NOT NULL DEFAULT 'waiting',
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_verification_item PRIMARY KEY (item_id),
  CONSTRAINT uq_item_record UNIQUE (record_id),
  CONSTRAINT fk_item_record FOREIGN KEY (record_id) REFERENCES inspection_record (record_id),
  CONSTRAINT fk_item_result FOREIGN KEY (result_id) REFERENCES analysis_result (result_id),
  CONSTRAINT chk_item_status CHECK (item_status IN ('waiting','data_requested','verified'))
);

-- ---------------------------------------------------------------------
-- E. 전문가·검증
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expert_specialty (
  expert_id       BIGINT      NOT NULL,
  specialty_code  VARCHAR(20) NOT NULL,
  CONSTRAINT pk_expert_specialty PRIMARY KEY (expert_id, specialty_code),
  CONSTRAINT fk_spec_user FOREIGN KEY (expert_id) REFERENCES user_account (user_id),
  -- 원천 [핵심 파트너] 2단계: 건축·구조·방수 전문가
  CONSTRAINT chk_specialty CHECK (specialty_code IN ('architecture','structure','waterproof'))
);

CREATE TABLE IF NOT EXISTS expert_availability (
  expert_id     BIGINT NOT NULL,
  available_on  DATE   NOT NULL,
  CONSTRAINT pk_expert_availability PRIMARY KEY (expert_id, available_on),
  CONSTRAINT fk_avail_user FOREIGN KEY (expert_id) REFERENCES user_account (user_id)
);

-- 판정은 덮어쓰지 않는다(UC4 특별 요구사항 1). 현재 판정 = 최대 version_no (v_current_verdict)
CREATE TABLE IF NOT EXISTS expert_verdict (
  verdict_id   BIGINT        NOT NULL AUTO_INCREMENT,   -- [M1]
  item_id      BIGINT        NOT NULL,
  version_no   SMALLINT      NOT NULL,
  expert_id    BIGINT        NOT NULL,
  verdict      VARCHAR(10)   NOT NULL,
  opinion      VARCHAR(1000) NULL,     -- UC4 A1 일치 승인은 의견 생략 가능
  diff_note    VARCHAR(500)  NULL,
  risk_high    BOOLEAN       NOT NULL DEFAULT FALSE,
  decided_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_expert_verdict PRIMARY KEY (verdict_id),
  CONSTRAINT uq_verdict_version UNIQUE (item_id, version_no),
  CONSTRAINT fk_verdict_item   FOREIGN KEY (item_id) REFERENCES verification_item (item_id),
  CONSTRAINT fk_verdict_expert FOREIGN KEY (expert_id) REFERENCES user_account (user_id),
  -- U4: 판정 불가는 이 테이블에 들어오지 않는다(data_request 로 분리)
  CONSTRAINT chk_verdict CHECK (verdict IN ('match','mismatch')),
  -- BR-DEF-07: 불일치는 차이 내용을 남긴다
  CONSTRAINT chk_verdict_diff CHECK (verdict <> 'mismatch' OR diff_note IS NOT NULL)
);

-- G6 판정 불가 · 추가 자료 요청. 수신자는 기록한 시설관리자로 유도(v_data_request_inbox)
CREATE TABLE IF NOT EXISTS data_request (
  data_req_id  BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  item_id      BIGINT       NOT NULL,
  expert_id    BIGINT       NOT NULL,
  reason       VARCHAR(200) NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at      TIMESTAMP    NULL,
  resolved_at  TIMESTAMP    NULL,
  CONSTRAINT pk_data_request PRIMARY KEY (data_req_id),
  CONSTRAINT fk_datareq_item   FOREIGN KEY (item_id) REFERENCES verification_item (item_id),
  CONSTRAINT fk_datareq_expert FOREIGN KEY (expert_id) REFERENCES user_account (user_id),
  CONSTRAINT chk_datareq_order CHECK (resolved_at IS NULL OR sent_at IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- F. 유지관리 계획·외부 이력·우선순위
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inspection_schedule (
  schedule_id          BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  building_id          BIGINT       NOT NULL,
  item_text            VARCHAR(200) NOT NULL,
  cycle_code           VARCHAR(20)  NULL,    -- 점검 주기 옵션 미정(§미해결)
  assignee_id          BIGINT       NOT NULL,
  due_date             DATE         NOT NULL,
  schedule_status      VARCHAR(10)  NOT NULL DEFAULT 'scheduled',
  completed_record_id  BIGINT       NULL,
  created_by           BIGINT       NOT NULL,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at         TIMESTAMP    NULL,
  CONSTRAINT pk_inspection_schedule PRIMARY KEY (schedule_id),
  CONSTRAINT uq_schedule_record UNIQUE (completed_record_id),
  CONSTRAINT fk_sched_building FOREIGN KEY (building_id) REFERENCES building (building_id),
  CONSTRAINT fk_sched_assignee FOREIGN KEY (assignee_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_sched_record   FOREIGN KEY (completed_record_id) REFERENCES inspection_record (record_id),
  CONSTRAINT fk_sched_creator  FOREIGN KEY (created_by) REFERENCES user_account (user_id),
  -- 도래·지연은 저장하지 않는다(v_schedule_status 에서 유도)
  CONSTRAINT chk_sched_status CHECK (schedule_status IN ('scheduled','completed','cancelled')),
  -- SD_01 §12: 완료는 이력 레코드 연결로만 판정한다
  CONSTRAINT chk_sched_completed CHECK (
    (schedule_status = 'completed' AND completed_record_id IS NOT NULL) OR
    (schedule_status <> 'completed' AND completed_record_id IS NULL)),
  CONSTRAINT chk_sched_cancelled CHECK (
    (schedule_status = 'cancelled' AND cancelled_at IS NOT NULL) OR
    (schedule_status <> 'cancelled' AND cancelled_at IS NULL))
);

-- P0 · UC6 배정 통지·도래 알림·지연 알림 발송 사실. 알림 수단은 미정(§미해결)
CREATE TABLE IF NOT EXISTS schedule_alert (
  alert_id      BIGINT      NOT NULL AUTO_INCREMENT,   -- [M1]
  schedule_id   BIGINT      NOT NULL,
  alert_kind    VARCHAR(10) NOT NULL,
  recipient_id  BIGINT      NOT NULL,
  sent_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_schedule_alert PRIMARY KEY (alert_id),
  CONSTRAINT fk_alert_sched     FOREIGN KEY (schedule_id) REFERENCES inspection_schedule (schedule_id),
  CONSTRAINT fk_alert_recipient FOREIGN KEY (recipient_id) REFERENCES user_account (user_id),
  CONSTRAINT chk_alert_kind CHECK (alert_kind IN ('assigned','due','overdue'))
);

-- UC5 E1 · UC8 E2: 연동 시도 기록. 최근 실패 여부가 C7 "외부 이력 미반영"이 된다
CREATE TABLE IF NOT EXISTS bms_sync_run (
  sync_id        BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  building_id    BIGINT       NOT NULL,
  started_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sync_status    VARCHAR(10)  NOT NULL,
  error_message  VARCHAR(300) NULL,
  CONSTRAINT pk_bms_sync_run PRIMARY KEY (sync_id),
  CONSTRAINT fk_sync_building FOREIGN KEY (building_id) REFERENCES building (building_id),
  CONSTRAINT chk_sync_status CHECK (sync_status IN ('ok','failed')),
  CONSTRAINT chk_sync_error  CHECK (sync_status <> 'failed' OR error_message IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS external_history (
  ext_id            BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  building_id       BIGINT       NOT NULL,
  sync_id           BIGINT       NOT NULL,
  bms_record_ref    VARCHAR(100) NOT NULL,
  occurred_on       DATE         NOT NULL,
  location_text     VARCHAR(200) NULL,
  defect_type_code  VARCHAR(20)  NULL,
  summary           VARCHAR(500) NOT NULL,
  CONSTRAINT pk_external_history PRIMARY KEY (ext_id),
  CONSTRAINT uq_ext_ref UNIQUE (building_id, bms_record_ref),
  CONSTRAINT fk_ext_building FOREIGN KEY (building_id) REFERENCES building (building_id),
  CONSTRAINT fk_ext_sync     FOREIGN KEY (sync_id) REFERENCES bms_sync_run (sync_id),
  CONSTRAINT fk_ext_defect   FOREIGN KEY (defect_type_code) REFERENCES defect_type_code (defect_type_code)
);

-- P6 우선순위 산출 스냅숏. 유도인데 저장: 산식이 분석 서비스에 있고 외부 데이터를 포함해 재현할 수 없다
CREATE TABLE IF NOT EXISTS priority_run (
  run_id                   BIGINT      NOT NULL AUTO_INCREMENT,   -- [M1]
  org_id                   BIGINT      NOT NULL,
  requested_by             BIGINT      NOT NULL,
  period_from              DATE        NOT NULL,
  period_to                DATE        NOT NULL,
  notice_id                BIGINT      NOT NULL,
  notice_kind              VARCHAR(20) NOT NULL DEFAULT 'priority',
  external_included        BOOLEAN     NOT NULL,
  excluded_building_count  INT         NOT NULL DEFAULT 0,
  created_at               TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_priority_run PRIMARY KEY (run_id),
  CONSTRAINT fk_prun_org       FOREIGN KEY (org_id) REFERENCES organization (org_id),
  CONSTRAINT fk_prun_requester FOREIGN KEY (requested_by) REFERENCES user_account (user_id),
  -- BR-DEF-01 · BR-DEF-11: 우선순위도 참고용 고지와 함께 존재한다
  CONSTRAINT fk_prun_notice    FOREIGN KEY (notice_id, notice_kind) REFERENCES notice_text (notice_id, notice_kind),
  CONSTRAINT chk_prun_notice_kind CHECK (notice_kind = 'priority'),
  CONSTRAINT chk_prun_period CHECK (period_from <= period_to),
  CONSTRAINT chk_prun_excluded CHECK (excluded_building_count >= 0)
);

CREATE TABLE IF NOT EXISTS priority_item (
  run_id            BIGINT       NOT NULL,
  priority_rank     INT          NOT NULL,
  building_id       BIGINT       NOT NULL,
  location_text     VARCHAR(200) NULL,
  defect_type_code  VARCHAR(20)  NOT NULL,
  confidence_level  VARCHAR(10)  NOT NULL,
  assigned_action   VARCHAR(12)  NULL,
  CONSTRAINT pk_priority_item PRIMARY KEY (run_id, priority_rank),
  CONSTRAINT fk_pitem_run      FOREIGN KEY (run_id) REFERENCES priority_run (run_id),
  CONSTRAINT fk_pitem_building FOREIGN KEY (building_id) REFERENCES building (building_id),
  CONSTRAINT fk_pitem_defect   FOREIGN KEY (defect_type_code) REFERENCES defect_type_code (defect_type_code),
  CONSTRAINT chk_pitem_rank CHECK (priority_rank >= 1),
  CONSTRAINT chk_pitem_conf CHECK (confidence_level IN ('normal','low')),
  CONSTRAINT chk_pitem_action CHECK (assigned_action IS NULL OR assigned_action IN ('inspection','expert'))
);

-- BR-DEF-12: 우선순위 항목의 근거 이력 (내부 레코드 또는 외부 이력 중 하나)
CREATE TABLE IF NOT EXISTS priority_item_basis (
  basis_id       BIGINT NOT NULL AUTO_INCREMENT,   -- [M1]
  run_id         BIGINT NOT NULL,
  priority_rank  INT    NOT NULL,
  record_id      BIGINT NULL,
  ext_id         BIGINT NULL,
  CONSTRAINT pk_priority_item_basis PRIMARY KEY (basis_id),
  CONSTRAINT fk_basis_item   FOREIGN KEY (run_id, priority_rank) REFERENCES priority_item (run_id, priority_rank),
  CONSTRAINT fk_basis_record FOREIGN KEY (record_id) REFERENCES inspection_record (record_id),
  CONSTRAINT fk_basis_ext    FOREIGN KEY (ext_id) REFERENCES external_history (ext_id),
  CONSTRAINT chk_basis_one CHECK (
    (record_id IS NOT NULL AND ext_id IS NULL) OR (record_id IS NULL AND ext_id IS NOT NULL))
);

-- ---------------------------------------------------------------------
-- G. 위험 통지·전문가 연결
-- ---------------------------------------------------------------------

-- SD_01 §12 위험 통지 인계물. 출처 3종 중 정확히 하나를 FK 로 가진다(다형 참조 대신 배타 FK)
CREATE TABLE IF NOT EXISTS risk_notice (
  risk_notice_id  BIGINT      NOT NULL AUTO_INCREMENT,   -- [M1]
  case_id         BIGINT      NOT NULL,
  source_kind     VARCHAR(12) NOT NULL,
  result_id       BIGINT      NULL,
  verdict_id      BIGINT      NULL,
  schedule_id     BIGINT      NULL,
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at       TIMESTAMP   NULL,
  close_reason    VARCHAR(12) NULL,
  CONSTRAINT pk_risk_notice PRIMARY KEY (risk_notice_id),
  CONSTRAINT fk_risk_case    FOREIGN KEY (case_id) REFERENCES defect_case (case_id),
  CONSTRAINT fk_risk_result  FOREIGN KEY (result_id) REFERENCES analysis_result (result_id),
  CONSTRAINT fk_risk_verdict FOREIGN KEY (verdict_id) REFERENCES expert_verdict (verdict_id),
  CONSTRAINT fk_risk_sched   FOREIGN KEY (schedule_id) REFERENCES inspection_schedule (schedule_id),
  CONSTRAINT chk_risk_source CHECK (
    (source_kind = 'analysis'   AND result_id IS NOT NULL AND verdict_id IS NULL AND schedule_id IS NULL) OR
    (source_kind = 'verdict'    AND result_id IS NULL AND verdict_id IS NOT NULL AND schedule_id IS NULL) OR
    (source_kind = 'inspection' AND result_id IS NULL AND verdict_id IS NULL AND schedule_id IS NOT NULL)),
  CONSTRAINT chk_risk_close CHECK (
    (closed_at IS NULL AND close_reason IS NULL) OR
    (closed_at IS NOT NULL AND close_reason IN ('connected','dismissed')))
);

CREATE TABLE IF NOT EXISTS expert_request (
  exp_req_id      BIGINT      NOT NULL AUTO_INCREMENT,   -- [M1]
  case_id         BIGINT      NOT NULL,
  building_id     BIGINT      NOT NULL,
  requester_id    BIGINT      NOT NULL,
  origin_kind     VARCHAR(12) NOT NULL,
  risk_notice_id  BIGINT      NULL,
  specialty_code  VARCHAR(20) NOT NULL,
  wish_from       DATE        NOT NULL,
  wish_to         DATE        NOT NULL,
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at       TIMESTAMP   NULL,
  CONSTRAINT pk_expert_request PRIMARY KEY (exp_req_id),
  CONSTRAINT fk_ereq_case      FOREIGN KEY (case_id) REFERENCES defect_case (case_id),
  CONSTRAINT fk_ereq_building  FOREIGN KEY (building_id) REFERENCES building (building_id),
  CONSTRAINT fk_ereq_requester FOREIGN KEY (requester_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_ereq_risk      FOREIGN KEY (risk_notice_id) REFERENCES risk_notice (risk_notice_id),
  CONSTRAINT chk_ereq_origin CHECK (origin_kind IN ('analysis','verdict','inspection','history','priority','direct')),
  -- UC7 A1: 권고·통지에서 진입한 요청은 그 통지를 가리킨다
  CONSTRAINT chk_ereq_origin_risk CHECK (
    origin_kind NOT IN ('analysis','verdict','inspection') OR risk_notice_id IS NOT NULL),
  CONSTRAINT chk_ereq_specialty CHECK (specialty_code IN ('architecture','structure','waterproof')),
  CONSTRAINT chk_ereq_wish CHECK (wish_from <= wish_to)
);

-- G9 / BR-DEF-11: 동의 시점의 공유 범위 문구를 고정 저장
CREATE TABLE IF NOT EXISTS share_consent (
  consent_id     BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  exp_req_id     BIGINT       NOT NULL,
  expert_id      BIGINT       NOT NULL,
  scope_text     VARCHAR(500) NOT NULL,   -- 유도인데 저장: 동의한 범위 고정
  notice_id      BIGINT       NOT NULL,
  notice_kind    VARCHAR(20)  NOT NULL DEFAULT 'share',
  consented_by   BIGINT       NOT NULL,
  consented_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_share_consent PRIMARY KEY (consent_id),
  CONSTRAINT uq_consent_triple UNIQUE (consent_id, exp_req_id, expert_id),
  CONSTRAINT fk_consent_req    FOREIGN KEY (exp_req_id) REFERENCES expert_request (exp_req_id),
  CONSTRAINT fk_consent_expert FOREIGN KEY (expert_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_consent_by     FOREIGN KEY (consented_by) REFERENCES user_account (user_id),
  CONSTRAINT fk_consent_notice FOREIGN KEY (notice_id, notice_kind) REFERENCES notice_text (notice_id, notice_kind),
  CONSTRAINT chk_consent_notice_kind CHECK (notice_kind = 'share')
);

-- G9: 동의 없이는 시도가 생기지 않는다(consent FK NOT NULL, 같은 요청·같은 전문가로 복합 FK)
CREATE TABLE IF NOT EXISTS expert_request_attempt (
  attempt_id      BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  exp_req_id      BIGINT       NOT NULL,
  expert_id       BIGINT       NOT NULL,
  consent_id      BIGINT       NOT NULL,
  sent_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  response        VARCHAR(12)  NULL,
  responded_at    TIMESTAMP    NULL,
  decline_reason  VARCHAR(200) NULL,
  CONSTRAINT pk_expert_request_attempt PRIMARY KEY (attempt_id),
  CONSTRAINT uq_attempt_consent UNIQUE (consent_id),
  CONSTRAINT fk_attempt_consent FOREIGN KEY (consent_id, exp_req_id, expert_id)
    REFERENCES share_consent (consent_id, exp_req_id, expert_id),
  CONSTRAINT chk_attempt_response CHECK (response IS NULL OR response IN ('accepted','declined','no_response')),
  CONSTRAINT chk_attempt_responded CHECK (
    (response IS NULL AND responded_at IS NULL) OR (response IS NOT NULL AND responded_at IS NOT NULL))
);

-- G10 / BR-DEF-09: 수락된 시도만 연결이 되고, 수수료는 여기에만 있다
CREATE TABLE IF NOT EXISTS expert_connection (
  connection_id  BIGINT        NOT NULL AUTO_INCREMENT,   -- [M1]
  attempt_id     BIGINT        NOT NULL,
  fee_amount     DECIMAL(12,0) NULL,    -- 유도인데 저장: 확정 시점 요율로 고정. 요율 미정 → NULL 허용
  confirmed_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_expert_connection PRIMARY KEY (connection_id),
  CONSTRAINT uq_connection_attempt UNIQUE (attempt_id),
  CONSTRAINT fk_conn_attempt FOREIGN KEY (attempt_id) REFERENCES expert_request_attempt (attempt_id)
);

-- ---------------------------------------------------------------------
-- H. 게이트 이벤트 (1급 엔티티)
-- ---------------------------------------------------------------------

-- 게이트 발생·해제 이력. subject 는 다형 참조 → 주기 점검 쿼리(§무결성) 로 고아 행을 찾는다
CREATE TABLE IF NOT EXISTS gate_event (
  event_id        BIGINT       NOT NULL AUTO_INCREMENT,   -- [M1]
  gate_code       VARCHAR(4)   NOT NULL,
  actor_id        BIGINT       NULL,
  subject_kind    VARCHAR(30)  NOT NULL,
  subject_id      BIGINT       NOT NULL,
  reason_text     VARCHAR(300) NULL,
  occurred_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at     TIMESTAMP    NULL,
  released_by     BIGINT       NULL,
  release_action  VARCHAR(100) NULL,
  CONSTRAINT pk_gate_event PRIMARY KEY (event_id),
  CONSTRAINT fk_gevent_gate     FOREIGN KEY (gate_code) REFERENCES gate_def (gate_code),
  CONSTRAINT fk_gevent_actor    FOREIGN KEY (actor_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_gevent_releaser FOREIGN KEY (released_by) REFERENCES user_account (user_id),
  CONSTRAINT chk_gevent_subject CHECK (subject_kind IN
    ('user_account','building','organization','payment','analysis_request','inspection_record',
     'verification_item','expert_request','expert_request_attempt')),
  CONSTRAINT chk_gevent_release CHECK (released_at IS NULL OR release_action IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- 인덱스 (조회 경로: 화면 목록·역추적 조인)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_case_building      ON defect_case (building_id);
CREATE INDEX IF NOT EXISTS ix_req_case           ON analysis_request (case_id);
CREATE INDEX IF NOT EXISTS ix_req_ent_status     ON analysis_request (entitlement_id, req_status);
CREATE INDEX IF NOT EXISTS ix_rec_building_type  ON inspection_record (building_id, defect_type_code, record_status);
CREATE INDEX IF NOT EXISTS ix_rec_result         ON inspection_record (result_id);
CREATE INDEX IF NOT EXISTS ix_item_status        ON verification_item (item_status);
CREATE INDEX IF NOT EXISTS ix_datareq_item_open  ON data_request (item_id, resolved_at);
CREATE INDEX IF NOT EXISTS ix_sched_building_due ON inspection_schedule (building_id, schedule_status, due_date);
CREATE INDEX IF NOT EXISTS ix_sched_assignee     ON inspection_schedule (assignee_id, schedule_status);
CREATE INDEX IF NOT EXISTS ix_sync_building_time ON bms_sync_run (building_id, started_at);
CREATE INDEX IF NOT EXISTS ix_ext_building       ON external_history (building_id, defect_type_code);
CREATE INDEX IF NOT EXISTS ix_risk_case_open     ON risk_notice (case_id, closed_at);
CREATE INDEX IF NOT EXISTS ix_attempt_req        ON expert_request_attempt (exp_req_id, response);
CREATE INDEX IF NOT EXISTS ix_gevent_subject     ON gate_event (subject_kind, subject_id, released_at);
CREATE INDEX IF NOT EXISTS ix_access_building    ON building_access (building_id);

-- ---------------------------------------------------------------------
-- 뷰 — 유도 속성과 게이트 판정의 단일 지점
-- ---------------------------------------------------------------------

-- 마스킹 조회 경로 (SD_02 ***@***.kr · 김** · 010-****-1234)  [M5] SUBSTRING_INDEX
CREATE OR REPLACE VIEW v_user_masked AS
SELECT u.user_id,
       CONCAT('***@***.', SUBSTRING_INDEX(u.email, '.', -1))           AS email_masked,
       CONCAT(LEFT(u.display_name, 1), '**')                           AS name_masked,
       CASE WHEN u.phone IS NULL THEN NULL
            ELSE CONCAT(LEFT(u.phone, 3), '-****-', RIGHT(u.phone, 4)) END AS phone_masked
FROM user_account u;

-- G0 판정 단일 지점: 건물 권한 (직접 부여 + 기업 관리자 소속)
CREATE OR REPLACE VIEW v_access_check AS
SELECT ba.user_id, ba.building_id, ba.access_kind
FROM building_access ba
UNION
SELECT u.user_id, b.building_id, 'manage' AS access_kind
FROM user_account u
JOIN user_role r ON r.user_id = u.user_id AND r.role_code = 'enterprise'
JOIN building b  ON b.org_id = u.org_id;

-- 이용권 잔여 (S2 "무료 체험 1회 남음"). 분석 중·완료 요청이 소진, 실패는 소진하지 않는다(SD_01 §12)
CREATE OR REPLACE VIEW v_entitlement_balance AS
SELECT e.entitlement_id, e.user_id, e.ent_kind, e.quota_total,
       (SELECT COUNT(*) FROM analysis_request q
         WHERE q.entitlement_id = e.entitlement_id AND q.req_status IN ('analyzing','completed')) AS used_count,
       CASE WHEN e.quota_total IS NULL THEN NULL
            ELSE e.quota_total - (SELECT COUNT(*) FROM analysis_request q
                   WHERE q.entitlement_id = e.entitlement_id AND q.req_status IN ('analyzing','completed')) END AS remaining,
       CASE WHEN e.valid_from <= CURRENT_TIMESTAMP
             AND (e.valid_until IS NULL OR e.valid_until >= CURRENT_TIMESTAMP)
             AND (e.quota_total IS NULL OR e.quota_total > (SELECT COUNT(*) FROM analysis_request q
                   WHERE q.entitlement_id = e.entitlement_id AND q.req_status IN ('analyzing','completed')))
            THEN 1 ELSE 0 END AS is_usable
FROM entitlement e;

-- G2 판정 단일 지점
CREATE OR REPLACE VIEW v_analysis_eligibility AS
SELECT u.user_id,
       CASE WHEN EXISTS (SELECT 1 FROM v_entitlement_balance b WHERE b.user_id = u.user_id AND b.is_usable = 1)
            THEN 1 ELSE 0 END AS eligible
FROM user_account u;

-- 현재 판정 = 최신 판본
CREATE OR REPLACE VIEW v_current_verdict AS
SELECT v.*
FROM expert_verdict v
WHERE v.version_no = (SELECT MAX(v2.version_no) FROM expert_verdict v2 WHERE v2.item_id = v.item_id);

-- 신뢰도 관리 지표 (UC4 사후조건 3 · BR-DEF-07). 판정 불가는 분모에 넣지 않는다
CREATE OR REPLACE VIEW v_ai_trust_metric AS
SELECT r.defect_type_code,
       COUNT(*)                                                 AS verdict_count,
       SUM(CASE WHEN cv.verdict = 'mismatch' THEN 1 ELSE 0 END) AS mismatch_count
FROM v_current_verdict cv
JOIN verification_item i  ON i.item_id = cv.item_id
JOIN inspection_record r  ON r.record_id = i.record_id
GROUP BY r.defect_type_code;

-- S4 검증 대기 목록 (불일치 내용은 유도: AI 1순위 원인 vs 현장 하자 종류)
CREATE OR REPLACE VIEW v_verification_queue AS
SELECT i.item_id, c.case_no, r.defect_type_code, i.item_status,
       (SELECT ac.cause_text FROM analysis_cause ac WHERE ac.result_id = i.result_id AND ac.cause_rank = 1) AS ai_top_cause,
       r.inspection_note AS field_note,
       i.created_at
FROM verification_item i
JOIN inspection_record r ON r.record_id = i.record_id
JOIN defect_case c       ON c.case_id = r.case_id
WHERE i.item_status IN ('waiting','data_requested');

-- S7B 추가 자료 요청 카드: 수신자 = 레코드 작성자 (G6 해제 주체 [추론])
CREATE OR REPLACE VIEW v_data_request_inbox AS
SELECT d.data_req_id, r.recorder_id AS recipient_id, c.case_no, d.reason, d.sent_at
FROM data_request d
JOIN verification_item i ON i.item_id = d.item_id
JOIN inspection_record r ON r.record_id = i.record_id
JOIN defect_case c       ON c.case_id = r.case_id
WHERE d.sent_at IS NOT NULL AND d.resolved_at IS NULL;

-- P0 단일 지점: 일정 표시 상태 (도래 기준일 미정이면 'due' 상태를 내지 않는다)  [M5] DATE_ADD · CAST AS SIGNED
CREATE OR REPLACE VIEW v_schedule_status AS
SELECT s.schedule_id, s.building_id, s.assignee_id, s.item_text, s.due_date,
       CASE
         WHEN s.schedule_status = 'completed' THEN 'completed'
         WHEN s.schedule_status = 'cancelled' THEN 'cancelled'
         WHEN s.due_date < CURRENT_DATE THEN 'overdue'
         WHEN k.const_value IS NOT NULL
              AND s.due_date <= DATE_ADD(CURRENT_DATE, INTERVAL CAST(k.const_value AS SIGNED) DAY) THEN 'due'
         ELSE 'scheduled'
       END AS display_status,
       CASE WHEN EXISTS (SELECT 1 FROM schedule_alert a
                          WHERE a.schedule_id = s.schedule_id AND a.alert_kind = 'overdue')
            THEN 1 ELSE 0 END AS overdue_alert_sent
FROM inspection_schedule s
LEFT JOIN service_constant k ON k.const_key = 'due_soon_days';

-- C7 단일 지점: 건물별 최근 연동 결과
CREATE OR REPLACE VIEW v_building_sync_state AS
SELECT b.building_id,
       (SELECT s.sync_status FROM bms_sync_run s WHERE s.building_id = b.building_id
         ORDER BY s.started_at DESC, s.sync_id DESC LIMIT 1) AS last_sync_status
FROM building b;

-- S5 시간순 통합 이력 (AI 분석 · 현장 기록 · 전문가 판정 · 전문가 연결 · 외부 이력)
CREATE OR REPLACE VIEW v_building_history AS
SELECT c.building_id, ar.completed_at AS occurred_at, 'ai_analysis' AS entry_kind,
       NULL AS location_text, NULL AS defect_type_code, ar.risk_level AS outcome, c.case_id, ar.result_id AS source_id
FROM analysis_result ar
JOIN analysis_request q ON q.request_id = ar.request_id
JOIN defect_case c      ON c.case_id = q.case_id
WHERE c.building_id IS NOT NULL
UNION ALL
SELECT r.building_id, r.saved_at, 'field_record', r.location_text, r.defect_type_code, r.repair_status, r.case_id, r.record_id
FROM inspection_record r
WHERE r.record_status = 'saved'
UNION ALL
SELECT r.building_id, cv.decided_at, 'expert_verdict', r.location_text, r.defect_type_code, cv.verdict, r.case_id, cv.verdict_id
FROM v_current_verdict cv
JOIN verification_item i ON i.item_id = cv.item_id
JOIN inspection_record r ON r.record_id = i.record_id
UNION ALL
SELECT er.building_id, ec.confirmed_at, 'expert_connection', NULL, NULL, 'connected', er.case_id, ec.connection_id
FROM expert_connection ec
JOIN expert_request_attempt t ON t.attempt_id = ec.attempt_id
JOIN expert_request er        ON er.exp_req_id = t.exp_req_id
UNION ALL
SELECT x.building_id, x.occurred_on, 'external', x.location_text, x.defect_type_code, x.summary, NULL, x.ext_id
FROM external_history x;

-- S5 반복 하자: 같은 건물·위치·하자 종류의 2회 이상 발생 (재발의 정의)
CREATE OR REPLACE VIEW v_repeat_defect AS
SELECT h.building_id, h.location_text, h.defect_type_code, COUNT(*) AS occurrence_count
FROM (SELECT building_id, location_text, defect_type_code FROM inspection_record WHERE record_status = 'saved'
      UNION ALL
      SELECT building_id, location_text, defect_type_code FROM external_history) h
WHERE h.location_text IS NOT NULL AND h.defect_type_code IS NOT NULL
GROUP BY h.building_id, h.location_text, h.defect_type_code
HAVING COUNT(*) >= 2;

-- G7 판정 단일 지점. 기준값 미정이면 통과시키지 않는다(U4 보수적 차단)
CREATE OR REPLACE VIEW v_pattern_gate AS
SELECT b.building_id,
       (SELECT COUNT(*) FROM inspection_record r WHERE r.building_id = b.building_id AND r.record_status = 'saved')
     + (SELECT COUNT(*) FROM external_history x WHERE x.building_id = b.building_id) AS history_count,
       k.const_value AS min_required,
       CASE WHEN k.const_value IS NULL THEN 0
            WHEN (SELECT COUNT(*) FROM inspection_record r WHERE r.building_id = b.building_id AND r.record_status = 'saved')
               + (SELECT COUNT(*) FROM external_history x WHERE x.building_id = b.building_id)
                 >= CAST(k.const_value AS SIGNED) THEN 1
            ELSE 0 END AS passed
FROM building b
LEFT JOIN service_constant k ON k.const_key = 'pattern_min_records';

-- 전문가 요청 상태 (S8A). 상태 컬럼을 저장하지 않고 시도·연결에서 유도
CREATE OR REPLACE VIEW v_expert_request_status AS
SELECT er.exp_req_id, er.case_id, er.building_id,
       CASE
         WHEN EXISTS (SELECT 1 FROM expert_connection ec JOIN expert_request_attempt t ON t.attempt_id = ec.attempt_id
                       WHERE t.exp_req_id = er.exp_req_id) THEN 'connected'
         WHEN er.closed_at IS NOT NULL THEN 'closed'
         WHEN EXISTS (SELECT 1 FROM expert_request_attempt t WHERE t.exp_req_id = er.exp_req_id AND t.response IS NULL) THEN 'awaiting'
         WHEN EXISTS (SELECT 1 FROM expert_request_attempt t WHERE t.exp_req_id = er.exp_req_id) THEN 'not_confirmed'
         ELSE 'drafting'
       END AS request_status
FROM expert_request er;

-- 건물 레일 (S5 · S6 · S7A)
CREATE OR REPLACE VIEW v_building_rail AS
SELECT b.building_id, b.building_name,
       (SELECT COUNT(*) FROM v_building_history h WHERE h.building_id = b.building_id) AS history_count,
       (SELECT COUNT(*) FROM v_schedule_status s WHERE s.building_id = b.building_id AND s.display_status = 'overdue') AS overdue_count,
       (SELECT COUNT(*) FROM v_expert_request_status x WHERE x.building_id = b.building_id AND x.request_status = 'awaiting') AS awaiting_count
FROM building b;

-- 하자 건 레일 (C1). 단계 상태: done · current · blocked:Gn · pending · n/a
CREATE OR REPLACE VIEW v_case_progress AS
SELECT c.case_id, c.case_no,
       CASE
         WHEN EXISTS (SELECT 1 FROM analysis_result ar JOIN analysis_request q ON q.request_id = ar.request_id
                       WHERE q.case_id = c.case_id) THEN 'done'
         WHEN EXISTS (SELECT 1 FROM gate_event g JOIN analysis_request q ON g.subject_kind = 'analysis_request' AND g.subject_id = q.request_id
                       WHERE q.case_id = c.case_id AND g.released_at IS NULL)
           THEN CONCAT('blocked:', (SELECT MIN(g.gate_code) FROM gate_event g JOIN analysis_request q
                                      ON g.subject_kind = 'analysis_request' AND g.subject_id = q.request_id
                                    WHERE q.case_id = c.case_id AND g.released_at IS NULL))
         ELSE 'current'
       END AS stage1_analysis,
       CASE
         WHEN EXISTS (SELECT 1 FROM inspection_record r WHERE r.case_id = c.case_id AND r.record_status = 'saved') THEN 'done'
         WHEN EXISTS (SELECT 1 FROM inspection_record r WHERE r.case_id = c.case_id) THEN 'current'
         WHEN c.building_id IS NULL THEN 'n/a'
         ELSE 'pending'
       END AS stage2_record,
       CASE
         WHEN EXISTS (SELECT 1 FROM verification_item i JOIN inspection_record r ON r.record_id = i.record_id
                       WHERE r.case_id = c.case_id AND i.item_status = 'verified') THEN 'done'
         WHEN EXISTS (SELECT 1 FROM verification_item i JOIN inspection_record r ON r.record_id = i.record_id
                       WHERE r.case_id = c.case_id AND i.item_status = 'data_requested') THEN 'blocked:G6'
         WHEN EXISTS (SELECT 1 FROM verification_item i JOIN inspection_record r ON r.record_id = i.record_id
                       WHERE r.case_id = c.case_id) THEN 'current'
         WHEN c.building_id IS NULL
           OR EXISTS (SELECT 1 FROM inspection_record r WHERE r.case_id = c.case_id
                       AND r.record_status = 'saved' AND r.ai_match <> 'mismatch') THEN 'n/a'
         ELSE 'pending'
       END AS stage3_verify,
       CASE
         WHEN EXISTS (SELECT 1 FROM v_expert_request_status x WHERE x.case_id = c.case_id AND x.request_status = 'connected') THEN 'done'
         WHEN EXISTS (SELECT 1 FROM v_expert_request_status x WHERE x.case_id = c.case_id AND x.request_status = 'awaiting') THEN 'blocked:G10'
         WHEN EXISTS (SELECT 1 FROM expert_request er WHERE er.case_id = c.case_id) THEN 'current'
         ELSE 'pending'
       END AS stage4_action
FROM defect_case c;

-- ---------------------------------------------------------------------
-- 트리거 — CHECK 로 표현할 수 없는 다중 행·시점 조건  [M3] [M4]
-- ---------------------------------------------------------------------
DELIMITER //

-- G1: 승인된 결제로만 유료 이용권이 생긴다
DROP TRIGGER IF EXISTS trg_entitlement_bi //
CREATE TRIGGER trg_entitlement_bi BEFORE INSERT ON entitlement FOR EACH ROW
BEGIN
  IF NEW.payment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM payment p WHERE p.payment_id = NEW.payment_id
          AND p.pay_status = 'approved' AND p.user_id = NEW.user_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G1: approved payment of the same user required';
  END IF;
END //

-- G2 · BR-DEF-03: 분석 단계 진입 시 사진 1장 이상 + 사용 가능한 이용권(v_entitlement_balance 단일 판정)
DROP TRIGGER IF EXISTS trg_request_bu //
CREATE TRIGGER trg_request_bu BEFORE UPDATE ON analysis_request FOR EACH ROW
BEGIN
  IF NEW.req_status = 'analyzing' AND OLD.req_status <> 'analyzing' THEN
    IF NOT EXISTS (SELECT 1 FROM analysis_photo p WHERE p.request_id = NEW.request_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-DEF-03: photo required before analysis';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM v_entitlement_balance b
                    WHERE b.entitlement_id = NEW.entitlement_id AND b.user_id = NEW.requester_id AND b.is_usable = 1) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G2: usable entitlement required';
    END IF;
  END IF;
END //

-- G3 · G4: 결과는 품질을 통과해 분석 중인 요청에만 생긴다
DROP TRIGGER IF EXISTS trg_result_bi //
CREATE TRIGGER trg_result_bi BEFORE INSERT ON analysis_result FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM analysis_request q WHERE q.request_id = NEW.request_id AND q.req_status = 'analyzing') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G3/G4: result only for request in analyzing state';
  END IF;
END //

-- 결과 생성 → 요청 완료, 주의·위험이면 위험 통지(BR-DEF-02 · EXT1 · UC1 E3)
DROP TRIGGER IF EXISTS trg_result_ai //
CREATE TRIGGER trg_result_ai AFTER INSERT ON analysis_result FOR EACH ROW
BEGIN
  UPDATE analysis_request SET req_status = 'completed' WHERE request_id = NEW.request_id;
  IF NEW.risk_level IN ('caution','danger') THEN
    INSERT INTO risk_notice (case_id, source_kind, result_id)
    SELECT q.case_id, 'analysis', NEW.result_id FROM analysis_request q WHERE q.request_id = NEW.request_id;
  END IF;
END //

-- 레코드는 임시 상태로 시작한다(사진은 레코드가 있어야 붙는다)
DROP TRIGGER IF EXISTS trg_record_bi //
CREATE TRIGGER trg_record_bi BEFORE INSERT ON inspection_record FOR EACH ROW
BEGIN
  IF NEW.record_status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UC3: record must start as draft';
  END IF;
END //

-- UC3 사후조건 2 · E4: 저장 전환 시 현장 사진 1장 이상. 저장 시각 기록
DROP TRIGGER IF EXISTS trg_record_bu //
CREATE TRIGGER trg_record_bu BEFORE UPDATE ON inspection_record FOR EACH ROW
BEGIN
  IF NEW.record_status = 'saved' AND OLD.record_status = 'draft' THEN
    IF NOT EXISTS (SELECT 1 FROM record_photo p WHERE p.record_id = NEW.record_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UC3 E4: field photo required before save';
    END IF;
    IF NEW.saved_at IS NULL THEN SET NEW.saved_at = CURRENT_TIMESTAMP; END IF;
  END IF;
  IF OLD.record_status = 'saved' AND NEW.record_status = 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UC3: saved record cannot return to draft';
  END IF;
END //

-- BR-DEF-07: 불일치로 저장되면 검증 대상 생성
DROP TRIGGER IF EXISTS trg_record_au //
CREATE TRIGGER trg_record_au AFTER UPDATE ON inspection_record FOR EACH ROW
BEGIN
  IF NEW.record_status = 'saved' AND OLD.record_status = 'draft' AND NEW.ai_match = 'mismatch' THEN
    INSERT INTO verification_item (record_id, result_id) VALUES (NEW.record_id, NEW.result_id);
  END IF;
END //

-- G6 해제: 추가 자료 요청이 보내진 건에 현장 사진이 더해지면 요청이 해소된다
DROP TRIGGER IF EXISTS trg_rphoto_ai //
-- [X2] 검증 대상 id 를 먼저 변수로 읽는다. UPDATE 문 안에서 verification_item 을 읽으면
--      연쇄 트리거(trg_datareq_au)의 verification_item 갱신이 ERROR 1442 로 거부된다(실측)
CREATE TRIGGER trg_rphoto_ai AFTER INSERT ON record_photo FOR EACH ROW
BEGIN
  DECLARE v_item BIGINT DEFAULT NULL;
  SELECT i.item_id INTO v_item FROM verification_item i WHERE i.record_id = NEW.record_id;
  IF v_item IS NOT NULL THEN
    UPDATE data_request
       SET resolved_at = CURRENT_TIMESTAMP
     WHERE item_id = v_item AND resolved_at IS NULL AND sent_at IS NOT NULL;
  END IF;
END //

-- G6: 열린 자료 요청이 있으면 판정을 저장할 수 없다. 판본 번호 부여
DROP TRIGGER IF EXISTS trg_verdict_bi //
CREATE TRIGGER trg_verdict_bi BEFORE INSERT ON expert_verdict FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM data_request d WHERE d.item_id = NEW.item_id AND d.resolved_at IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G6: open data request blocks verdict';
  END IF;
  SET NEW.version_no = COALESCE((SELECT MAX(v.version_no) FROM expert_verdict v WHERE v.item_id = NEW.item_id), 0) + 1;
END //

-- 판정 저장 → 검증 완료, 위험 큼이면 위험 통지(UC4 E4)
DROP TRIGGER IF EXISTS trg_verdict_ai //
CREATE TRIGGER trg_verdict_ai AFTER INSERT ON expert_verdict FOR EACH ROW
BEGIN
  UPDATE verification_item SET item_status = 'verified' WHERE item_id = NEW.item_id;
  IF NEW.risk_high THEN
    INSERT INTO risk_notice (case_id, source_kind, verdict_id)
    SELECT r.case_id, 'verdict', NEW.verdict_id
      FROM verification_item i JOIN inspection_record r ON r.record_id = i.record_id
     WHERE i.item_id = NEW.item_id;
  END IF;
END //

DROP TRIGGER IF EXISTS trg_datareq_ai //
CREATE TRIGGER trg_datareq_ai AFTER INSERT ON data_request FOR EACH ROW
BEGIN
  UPDATE verification_item SET item_status = 'data_requested' WHERE item_id = NEW.item_id;
END //

DROP TRIGGER IF EXISTS trg_datareq_au //
CREATE TRIGGER trg_datareq_au AFTER UPDATE ON data_request FOR EACH ROW
BEGIN
  IF NEW.resolved_at IS NOT NULL AND OLD.resolved_at IS NULL THEN
    UPDATE verification_item SET item_status = 'waiting' WHERE item_id = NEW.item_id;
  END IF;
END //

-- SD_01 §12: 완료 연결 레코드는 같은 건물의 저장된 레코드여야 한다
DROP TRIGGER IF EXISTS trg_schedule_bu //
CREATE TRIGGER trg_schedule_bu BEFORE UPDATE ON inspection_schedule FOR EACH ROW
BEGIN
  IF NEW.completed_record_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM inspection_record r WHERE r.record_id = NEW.completed_record_id
          AND r.record_status = 'saved' AND r.building_id = NEW.building_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'P7: completion needs saved record of same building';
  END IF;
END //

-- G10 · BR-DEF-09: 수락된 시도만 연결(수수료)이 된다. 연결 시 위험 통지를 닫는다
DROP TRIGGER IF EXISTS trg_connection_bi //
CREATE TRIGGER trg_connection_bi BEFORE INSERT ON expert_connection FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM expert_request_attempt t WHERE t.attempt_id = NEW.attempt_id AND t.response = 'accepted') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G10: connection only for accepted attempt';
  END IF;
END //

DROP TRIGGER IF EXISTS trg_connection_ai //
CREATE TRIGGER trg_connection_ai AFTER INSERT ON expert_connection FOR EACH ROW
BEGIN
  UPDATE risk_notice n
     SET n.closed_at = CURRENT_TIMESTAMP, n.close_reason = 'connected'
   WHERE n.closed_at IS NULL
     AND n.risk_notice_id = (SELECT er.risk_notice_id FROM expert_request_attempt t
                               JOIN expert_request er ON er.exp_req_id = t.exp_req_id
                              WHERE t.attempt_id = NEW.attempt_id);
END //

DELIMITER ;

-- ---------------------------------------------------------------------
-- 기준 데이터 (멱등: 없을 때만 넣는다)
-- ---------------------------------------------------------------------
INSERT INTO gate_def (gate_code, gate_name, block_message, release_party)
SELECT * FROM (
  SELECT 'G0' AS c, '로그인 권한' AS n, '이 화면을 볼 권한이 없습니다' AS m, '본인(로그인) 또는 권한 부여자' AS p UNION ALL
  SELECT 'G1', '결제 승인', '결제가 승인되지 않아 이용권이 부여되지 않았습니다', '일반 사용자' UNION ALL
  SELECT 'G2', '분석 이용권', '분석 이용권이 없습니다 - 무료 체험을 모두 사용했습니다', '일반 사용자' UNION ALL
  SELECT 'G3', '사진 품질', '사진 품질이 분석에 적합하지 않아 분석할 수 없습니다', '일반 사용자' UNION ALL
  SELECT 'G4', 'AI 응답', '분석에 실패했습니다', '일반 사용자' UNION ALL
  SELECT 'G5', '필수 항목', '필수 항목이 비어 있어 저장할 수 없습니다', '시설관리자' UNION ALL
  SELECT 'G6', '판정 가능', '자료가 부족해 판정할 수 없습니다', '기록한 시설관리자' UNION ALL
  SELECT 'G7', '패턴 데이터 충분성', '이력이 부족해 반복 하자를 판단할 수 없습니다', '시설관리자 - 이력 축적' UNION ALL
  SELECT 'G8', '전문가 후보', '조건에 맞는 전문가가 없습니다', '건물관리자' UNION ALL
  SELECT 'G9', '공유 동의', '공유 범위에 동의해야 요청을 확정할 수 있습니다', '건물관리자' UNION ALL
  SELECT 'G10', '전문가 수락', '전문가 수락 전에는 연결이 확정되지 않습니다', '전문가'
) s WHERE NOT EXISTS (SELECT 1 FROM gate_def g WHERE g.gate_code = s.c);

INSERT INTO service_constant (const_key, const_value, unit, description)
SELECT * FROM (
  SELECT 'free_trial_count' AS k, NULL AS v, '회' AS u, '무료 체험 분석 횟수 - 원천 없음' AS d UNION ALL
  SELECT 'pattern_min_records', NULL, '건', 'G7 반복 하자 판단 최소 이력 수 - 원천 없음' UNION ALL
  SELECT 'due_soon_days', NULL, '일', 'P0 도래 판정 기준일 - 원천 없음' UNION ALL
  SELECT 'expert_response_hours', NULL, '시간', 'G10 무응답 판정 시한 - 원천 없음' UNION ALL
  SELECT 'ai_low_confidence', NULL, '0~1', 'UC1 E3 신뢰도 낮음 기준 - 원천 없음' UNION ALL
  SELECT 'expert_fee_rate', NULL, NULL, 'BR-DEF-09 연결 수수료 요율 - 원천 없음' UNION ALL
  SELECT 'retention_days', NULL, '일', '사진·결과·이력 보존 기간 - 원천 없음'
) s WHERE NOT EXISTS (SELECT 1 FROM service_constant c WHERE c.const_key = s.k);

INSERT INTO notice_text (notice_kind, body)
SELECT * FROM (
  SELECT 'analysis' AS k, '이미지 기반 1차 참고용 정보이며 법적·구조적 안전 판정을 대체하지 않습니다. 위험 가능성이 판정된 경우 반드시 자격 있는 전문가의 점검을 받으세요.' AS b UNION ALL
  SELECT 'priority', '우선순위는 이력과 하자 발생 패턴에 근거한 참고용 정보이며 구조적 안전 판정을 대체하지 않습니다.' UNION ALL
  SELECT 'share', '연결 수수료는 전문가 수락으로 연결이 확정될 때만 부과됩니다. 동의한 자료만 선택한 전문가에게 공유됩니다.'
) s WHERE NOT EXISTS (SELECT 1 FROM notice_text n WHERE n.notice_kind = s.k);

INSERT INTO defect_type_code (defect_type_code, defect_type_name)
SELECT * FROM (
  SELECT 'crack' AS c, '균열' AS n UNION ALL
  SELECT 'leak', '누수' UNION ALL
  SELECT 'condensation', '결로'
) s WHERE NOT EXISTS (SELECT 1 FROM defect_type_code d WHERE d.defect_type_code = s.c);

-- 원천에 등장하는 건물 유형만 넣는다. 나머지 코드는 미정(§미해결)
INSERT INTO building_type_code (building_type_code, building_type_name)
SELECT 'apartment', '공동주택' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM building_type_code t WHERE t.building_type_code = 'apartment');

INSERT INTO service_plan (plan_code, plan_name, price_amount, analysis_quota, period_months)
SELECT * FROM (
  SELECT 'per_analysis' AS c, '건별 유료 분석' AS n, NULL AS p, 1 AS q, NULL AS m UNION ALL
  SELECT 'monthly', '월 구독', NULL, NULL, 1
) s WHERE NOT EXISTS (SELECT 1 FROM service_plan sp WHERE sp.plan_code = s.c);
