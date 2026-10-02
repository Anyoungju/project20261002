-- =====================================================================
-- 002_app_extensions.sql — 앱 운영 확장 (research R9 · R22)
-- 원칙: 001(설계 DDL 원본)을 바꾸지 않고 "추가만" 한다. 모든 문장은 멱등.
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migration (
  filename   VARCHAR(200) NOT NULL,
  checksum   CHAR(64)     NOT NULL,
  applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_schema_migration PRIMARY KEY (filename)
);

-- FR-120: 비회원도 defect_case.owner_id 가 NOT NULL 이므로 계정 행이 필요하다
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;

-- FR-001 로그인. DDL user_account 에 비밀번호 칸이 없다. R22: token_version 으로 세션 즉시 무효화
CREATE TABLE IF NOT EXISTS user_credential (
  user_id               BIGINT       NOT NULL,
  password_hash         VARCHAR(100) NOT NULL,
  token_version         INT          NOT NULL DEFAULT 0,
  must_change_password  BOOLEAN      NOT NULL DEFAULT FALSE,
  disabled_at           TIMESTAMP    NULL,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_user_credential PRIMARY KEY (user_id),
  CONSTRAINT fk_cred_user FOREIGN KEY (user_id) REFERENCES user_account (user_id)
);

-- FR-120 · FR-120a: 기기 단위 무료 체험과 계정 연결. 토큰은 해시만 저장
CREATE TABLE IF NOT EXISTS guest_device (
  device_id       BIGINT     NOT NULL AUTO_INCREMENT,
  token_hash      CHAR(64)   NOT NULL,
  guest_user_id   BIGINT     NOT NULL,
  linked_user_id  BIGINT     NULL,
  created_at      TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  linked_at       TIMESTAMP  NULL,
  CONSTRAINT pk_guest_device PRIMARY KEY (device_id),
  CONSTRAINT uq_guest_device_token UNIQUE (token_hash),
  CONSTRAINT fk_gdev_guest  FOREIGN KEY (guest_user_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_gdev_linked FOREIGN KEY (linked_user_id) REFERENCES user_account (user_id),
  CONSTRAINT chk_gdev_link CHECK ((linked_user_id IS NULL AND linked_at IS NULL) OR (linked_user_id IS NOT NULL AND linked_at IS NOT NULL))
);

-- 건 번호 D-YYYY-NNNN 발급 (FOR UPDATE)
CREATE TABLE IF NOT EXISTS case_no_seq (
  seq_year  INT NOT NULL,
  last_no   INT NOT NULL DEFAULT 0,
  CONSTRAINT pk_case_no_seq PRIMARY KEY (seq_year)
);

-- UC6 E3 "점검 결과 위험" — 기존 CHECK 보존을 위해 별도 테이블
CREATE TABLE IF NOT EXISTS inspection_record_risk (
  record_id   BIGINT     NOT NULL,
  risk_flag   BOOLEAN    NOT NULL DEFAULT TRUE,
  flagged_at  TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_record_risk PRIMARY KEY (record_id),
  CONSTRAINT fk_rrisk_record FOREIGN KEY (record_id) REFERENCES inspection_record (record_id)
);

-- 저장 기록의 보수 결과 갱신 이력 (스펙 Assumptions)
CREATE TABLE IF NOT EXISTS record_repair_log (
  log_id      BIGINT      NOT NULL AUTO_INCREMENT,
  record_id   BIGINT      NOT NULL,
  old_status  VARCHAR(10) NOT NULL,
  new_status  VARCHAR(10) NOT NULL,
  changed_by  BIGINT      NOT NULL,
  changed_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_record_repair_log PRIMARY KEY (log_id),
  CONSTRAINT fk_rlog_record FOREIGN KEY (record_id) REFERENCES inspection_record (record_id),
  CONSTRAINT fk_rlog_user   FOREIGN KEY (changed_by) REFERENCES user_account (user_id),
  CONSTRAINT chk_rlog_status CHECK (old_status IN ('completed','pending') AND new_status IN ('completed','pending'))
);

-- G3 사진 품질 기준·사유 문구 (research R8)
CREATE TABLE IF NOT EXISTS photo_quality_rule (
  rule_key     VARCHAR(40)    NOT NULL,
  threshold    DECIMAL(12,4)  NOT NULL,
  reason_text  VARCHAR(200)   NOT NULL,
  CONSTRAINT pk_photo_quality_rule PRIMARY KEY (rule_key)
);
INSERT INTO photo_quality_rule (rule_key, threshold, reason_text)
SELECT * FROM (
  SELECT 'min_short_side' AS k, 640 AS t, '사진 해상도가 낮습니다 - 짧은 변 640px 이상으로 다시 찍어 주세요' AS r UNION ALL
  SELECT 'min_luma', 0.08, '사진이 너무 어둡습니다 - 밝은 곳에서 다시 찍어 주세요' UNION ALL
  SELECT 'max_luma', 0.92, '사진이 너무 밝습니다 - 빛 반사를 피해 다시 찍어 주세요' UNION ALL
  SELECT 'min_sharpness', 40, '사진이 흐립니다 - 초점을 맞춰 다시 찍어 주세요'
) s WHERE NOT EXISTS (SELECT 1 FROM photo_quality_rule p WHERE p.rule_key = s.k);

-- 서비스 내 알림 (R18)
CREATE TABLE IF NOT EXISTS notification (
  notif_id      BIGINT       NOT NULL AUTO_INCREMENT,
  recipient_id  BIGINT       NOT NULL,
  kind          VARCHAR(30)  NOT NULL,
  ref_kind      VARCHAR(30)  NULL,
  ref_id        BIGINT       NULL,
  title         VARCHAR(200) NOT NULL,
  link          VARCHAR(300) NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at       TIMESTAMP    NULL,
  CONSTRAINT pk_notification PRIMARY KEY (notif_id),
  CONSTRAINT fk_notif_recipient FOREIGN KEY (recipient_id) REFERENCES user_account (user_id)
);
CREATE INDEX IF NOT EXISTS ix_notif_recipient ON notification (recipient_id, read_at);

-- ---------------------------------------------------------------------
-- R22 인증·RBAC
-- ---------------------------------------------------------------------

-- DDL chk_role_code 가 업무 역할 5종만 허용하므로 시스템 역할은 별도
CREATE TABLE IF NOT EXISTS user_system_role (
  user_id     BIGINT      NOT NULL,
  role_code   VARCHAR(20) NOT NULL,
  granted_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_user_system_role PRIMARY KEY (user_id, role_code),
  CONSTRAINT fk_sysrole_user FOREIGN KEY (user_id) REFERENCES user_account (user_id),
  CONSTRAINT chk_sysrole_code CHECK (role_code IN ('operator'))
);

CREATE TABLE IF NOT EXISTS rbac_permission (
  permission_code  VARCHAR(50)  NOT NULL,
  description      VARCHAR(200) NOT NULL,
  locked           BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT pk_rbac_permission PRIMARY KEY (permission_code)
);

CREATE TABLE IF NOT EXISTS rbac_role_permission (
  role_code        VARCHAR(20) NOT NULL,
  permission_code  VARCHAR(50) NOT NULL,
  CONSTRAINT pk_rbac_role_permission PRIMARY KEY (role_code, permission_code),
  CONSTRAINT fk_rrp_permission FOREIGN KEY (permission_code) REFERENCES rbac_permission (permission_code),
  CONSTRAINT chk_rrp_role CHECK (role_code IN ('guest','general','facility','building','enterprise','expert','operator'))
);

CREATE TABLE IF NOT EXISTS rbac_audit_log (
  audit_id        BIGINT       NOT NULL AUTO_INCREMENT,
  actor_id        BIGINT       NOT NULL,
  action          VARCHAR(40)  NOT NULL,
  target_user_id  BIGINT       NULL,
  detail_json     VARCHAR(2000) NULL,
  at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_rbac_audit_log PRIMARY KEY (audit_id),
  CONSTRAINT fk_audit_actor  FOREIGN KEY (actor_id) REFERENCES user_account (user_id),
  CONSTRAINT fk_audit_target FOREIGN KEY (target_user_id) REFERENCES user_account (user_id)
);

CREATE TABLE IF NOT EXISTS auth_login_attempt (
  attempt_id    BIGINT       NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL,
  success       BOOLEAN      NOT NULL,
  attempted_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_auth_login_attempt PRIMARY KEY (attempt_id)
);
CREATE INDEX IF NOT EXISTS ix_login_attempt_email ON auth_login_attempt (email, attempted_at);

-- R14 Idempotency-Key
CREATE TABLE IF NOT EXISTS idempotency_record (
  idem_key       VARCHAR(100) NOT NULL,
  user_scope     VARCHAR(80)  NOT NULL,
  route          VARCHAR(200) NOT NULL,
  status_code    INT          NULL,
  response_body  MEDIUMTEXT   NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_idempotency_record PRIMARY KEY (idem_key, user_scope, route)
);

-- ---------------------------------------------------------------------
-- 운영 기준값 추가 키 (값 없음 = 보수적 동작) · 우선순위 가중치(R16)
-- ---------------------------------------------------------------------
INSERT INTO service_constant (const_key, const_value, unit, description)
SELECT * FROM (
  SELECT 'expert_fee_base' AS k, NULL AS v, '원' AS u, '연결 수수료 기준 금액 - 요율 × 기준 (SD_03 기준 미정)' AS d UNION ALL
  SELECT 'priority_w_repeat', '3', NULL, 'R16 우선순위 가중치 - 재발 횟수' UNION ALL
  SELECT 'priority_w_risk', '2', NULL, 'R16 우선순위 가중치 - 최고 위험도' UNION ALL
  SELECT 'priority_w_age', '1', NULL, 'R16 우선순위 가중치 - 미조치 기간' UNION ALL
  SELECT 'priority_w_open_notice', '2', NULL, 'R16 우선순위 가중치 - 열린 위험 통지'
) s WHERE NOT EXISTS (SELECT 1 FROM service_constant c WHERE c.const_key = s.k);
