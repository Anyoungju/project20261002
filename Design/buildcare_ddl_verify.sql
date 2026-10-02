-- =====================================================================
-- Buildcare AI - DDL 검증 스크립트 (실행 검증 ③ 위반 거부 확인)
-- 사용: 빈 DB 에 buildcare_ddl.sql 을 적용한 뒤
--       mariadb --force <db명> < buildcare_ddl_verify.sql
-- --force 로 오류 후에도 계속 진행한다. 'EXPECT REJECT' 다음 줄에는 ERROR 가 나와야 하고,
-- 'EXPECT OK' 다음에는 ERROR 가 없어야 한다.
-- 주의: MariaDB 는 트리거가 갱신하는 테이블을 같은 문장이 읽으면 거부한다(ERROR 1442).
--       verification_item 을 SELECT 하며 data_request·expert_verdict 에 INSERT 하지 말고 item_id 를 값으로 넘긴다.
-- =====================================================================

-- 고정 데이터 -----------------------------------------------------------
INSERT INTO organization (org_id, org_name) VALUES (1, '테스트 FM');
INSERT INTO user_account (user_id, email, display_name, phone, org_id) VALUES
 (1, 'user@example.kr', '홍길동', '01012341234', NULL),
 (2, 'fm@example.kr', '김현장', '01022223333', 1),
 (3, 'bm@example.kr', '이관리', '01033334444', 1),
 (4, 'em@example.kr', '박기업', '01044445555', 1),
 (5, 'ex@example.kr', '최전문', '01055556666', NULL),
 (6, 'ex2@example.kr', '정전문', '01066667777', NULL);
INSERT INTO user_role VALUES (1,'general'),(2,'facility'),(3,'building'),(4,'enterprise'),(5,'expert'),(6,'expert');
INSERT INTO building (building_id, org_id, building_name, building_type_code) VALUES
 (1, 1, '강남 오피스타워 A동', 'apartment'), (2, 1, '성수 FM센터', 'apartment');
INSERT INTO building_access (user_id, building_id, access_kind) VALUES (2,1,'record'),(3,1,'manage');
INSERT INTO expert_specialty VALUES (5,'structure'),(6,'structure');

SELECT 'T01 entitlement per_analysis without payment' AS test, 'EXPECT REJECT' AS expect;
INSERT INTO entitlement (user_id, ent_kind, quota_total) VALUES (1, 'per_analysis', 1);

SELECT 'T02 declined payment without reason (G1)', 'EXPECT REJECT';
INSERT INTO payment (user_id, plan_code, pay_status, decided_at) VALUES (1, 'per_analysis', 'declined', CURRENT_TIMESTAMP);

SELECT 'T03 entitlement from declined payment (G1)', 'EXPECT REJECT';
INSERT INTO payment (payment_id, user_id, plan_code, pay_status, decline_reason, decided_at)
  VALUES (10, 1, 'per_analysis', 'declined', '결제 수단 거절', CURRENT_TIMESTAMP);
INSERT INTO entitlement (user_id, ent_kind, payment_id, quota_total) VALUES (1, 'per_analysis', 10, 1);

SELECT 'T04 entitlement from approved payment', 'EXPECT OK';
INSERT INTO payment (payment_id, user_id, plan_code, pay_status, decided_at)
  VALUES (11, 1, 'per_analysis', 'approved', CURRENT_TIMESTAMP);
INSERT INTO entitlement (entitlement_id, user_id, ent_kind, payment_id, quota_total) VALUES (100, 1, 'per_analysis', 11, 1);

-- 하자 건과 분석 요청
INSERT INTO defect_case (case_id, case_no, owner_id, building_id) VALUES (1, 'D-2026-0142', 2, 1);
INSERT INTO entitlement (entitlement_id, user_id, ent_kind, quota_total) VALUES (101, 2, 'free_trial', 1);
INSERT INTO analysis_request (request_id, case_id, requester_id, entitlement_id, description)
  VALUES (1, 1, 2, 101, '3층 북측 외벽 - 장마 후 균열 폭이 커짐');

SELECT 'T05 analyzing without photo (BR-DEF-03)', 'EXPECT REJECT';
UPDATE analysis_request SET req_status = 'analyzing' WHERE request_id = 1;

SELECT 'T06 analyzing without entitlement (G2 CHECK)', 'EXPECT REJECT';
INSERT INTO analysis_photo (request_id, storage_key) VALUES (1, 'photos/1.jpg');
UPDATE analysis_request SET req_status = 'analyzing', entitlement_id = NULL WHERE request_id = 1;

SELECT 'T07 analyzing with free trial, result danger -> risk_notice auto', 'EXPECT OK';
UPDATE analysis_request SET req_status = 'analyzing' WHERE request_id = 1;
INSERT INTO analysis_result (result_id, request_id, notice_id, risk_level, ai_confidence)
  SELECT 1, 1, notice_id, 'danger', 0.820 FROM notice_text WHERE notice_kind = 'analysis';
INSERT INTO analysis_cause VALUES (1, 1, '외벽 건조수축 균열'), (1, 2, '우수 침투에 따른 균열 확장');
INSERT INTO analysis_action VALUES (1, 1, '같은 위치에서 다시 촬영해 변화를 확인합니다');
SELECT req_status AS t07_request_status FROM analysis_request WHERE request_id = 1;
SELECT COUNT(*) AS t07_risk_notice_count FROM risk_notice WHERE result_id = 1;

SELECT 'T08 second analysis on used-up free trial (G2 trigger)', 'EXPECT REJECT';
INSERT INTO analysis_request (request_id, case_id, requester_id, entitlement_id) VALUES (2, 1, 2, 101);
INSERT INTO analysis_photo (request_id, storage_key) VALUES (2, 'photos/2.jpg');
UPDATE analysis_request SET req_status = 'analyzing' WHERE request_id = 2;

SELECT 'T09 quality_rejected without reason (G3)', 'EXPECT REJECT';
UPDATE analysis_request SET req_status = 'quality_rejected' WHERE request_id = 2;

SELECT 'T10 result for quality_rejected request (G3)', 'EXPECT REJECT';
UPDATE analysis_request SET req_status = 'quality_rejected', quality_reject_reason = '초점 흐림' WHERE request_id = 2;
INSERT INTO analysis_result (request_id, notice_id, risk_level)
  SELECT 2, notice_id, 'normal' FROM notice_text WHERE notice_kind = 'analysis';

SELECT 'T11 result with priority notice instead of analysis notice (BR-DEF-01)', 'EXPECT REJECT';
UPDATE analysis_request SET req_status = 'analyzing', entitlement_id = 100, requester_id = 1 WHERE request_id = 2;
INSERT INTO analysis_result (request_id, notice_id, risk_level)
  SELECT 2, notice_id, 'normal' FROM notice_text WHERE notice_kind = 'priority';

-- 현장 기록
SELECT 'T12 record inserted directly as saved', 'EXPECT REJECT';
INSERT INTO inspection_record (case_id, building_id, recorder_id, record_status) VALUES (1, 1, 2, 'saved');

SELECT 'T13 save record without repair_status (G5 / BR-DEF-06)', 'EXPECT REJECT';
INSERT INTO inspection_record (record_id, case_id, building_id, recorder_id, result_id, location_text, defect_type_code, ai_match)
  VALUES (1, 1, 1, 2, 1, '3층 북측 외벽', 'crack', 'mismatch');
INSERT INTO record_photo (record_id, storage_key) VALUES (1, 'field/1.jpg');
UPDATE inspection_record SET record_status = 'saved' WHERE record_id = 1;

SELECT 'T14 save record without field photo (UC3 E4)', 'EXPECT REJECT';
INSERT INTO inspection_record (record_id, case_id, building_id, recorder_id, location_text, defect_type_code, repair_status, ai_match)
  VALUES (2, 1, 1, 2, '지하 1층', 'leak', 'pending', 'none');
UPDATE inspection_record SET record_status = 'saved' WHERE record_id = 2;

SELECT 'T15 save mismatch record -> verification_item auto (BR-DEF-07)', 'EXPECT OK';
UPDATE inspection_record SET repair_status = 'pending', inspection_note = '구조 균열 의심', record_status = 'saved' WHERE record_id = 1;
SELECT item_id AS t15_item_id, item_status FROM verification_item WHERE record_id = 1;

SELECT 'T16 mismatch verdict without diff_note (BR-DEF-07)', 'EXPECT REJECT';
INSERT INTO expert_verdict (item_id, version_no, expert_id, verdict) VALUES (1, 0, 5, 'mismatch');

SELECT 'T17 verdict while data request is open (G6)', 'EXPECT REJECT';
INSERT INTO data_request (data_req_id, item_id, expert_id, reason, sent_at)
  VALUES (1, 1, 5, '현장 사진 초점 흐림', CURRENT_TIMESTAMP);
INSERT INTO expert_verdict (item_id, version_no, expert_id, verdict, diff_note) VALUES (1, 0, 5, 'mismatch', '구조 균열');

SELECT 'T18 new field photo resolves G6, then verdict with risk_high', 'EXPECT OK';
INSERT INTO record_photo (record_id, storage_key) VALUES (1, 'field/1b.jpg');
SELECT resolved_at IS NOT NULL AS t18_resolved, (SELECT item_status FROM verification_item WHERE record_id = 1) AS t18_item_status FROM data_request WHERE data_req_id = 1;
INSERT INTO expert_verdict (verdict_id, item_id, version_no, expert_id, verdict, diff_note, risk_high)
  VALUES (1, 1, 0, 5, 'mismatch', 'AI 건조수축 - 현장 구조 균열', TRUE);
SELECT version_no AS t18_version FROM expert_verdict WHERE verdict_id = 1;
SELECT COUNT(*) AS t18_risk_from_verdict FROM risk_notice WHERE verdict_id = 1;

-- 정기점검
SELECT 'T19 schedule completed without record', 'EXPECT REJECT';
INSERT INTO inspection_schedule (building_id, item_text, assignee_id, due_date, schedule_status, created_by)
  VALUES (1, '외벽 균열', 2, '2026-09-30', 'completed', 3);

SELECT 'T20 schedule completion with record of another building', 'EXPECT REJECT';
INSERT INTO inspection_schedule (schedule_id, building_id, item_text, assignee_id, due_date, created_by)
  VALUES (1, 2, '옥상 방수', 2, '2026-10-15', 3);
UPDATE inspection_schedule SET schedule_status = 'completed', completed_record_id = 1 WHERE schedule_id = 1;

-- 전문가 연결
INSERT INTO expert_request (exp_req_id, case_id, building_id, requester_id, origin_kind, risk_notice_id, specialty_code, wish_from, wish_to)
  SELECT 1, 1, 1, 3, 'verdict', risk_notice_id, 'structure', '2026-10-10', '2026-10-17' FROM risk_notice WHERE verdict_id = 1;
INSERT INTO share_consent (consent_id, exp_req_id, expert_id, scope_text, notice_id, consented_by)
  SELECT 1, 1, 5, '하자 사진 2장 - 위치 - AI 결과 - 현장 기록 - 전문가 판정', notice_id, 3 FROM notice_text WHERE notice_kind = 'share';

SELECT 'T21 attempt to expert 6 using consent given for expert 5 (G9)', 'EXPECT REJECT';
INSERT INTO expert_request_attempt (exp_req_id, expert_id, consent_id) VALUES (1, 6, 1);

SELECT 'T22 connection on declined attempt (G10 / BR-DEF-09)', 'EXPECT REJECT';
INSERT INTO expert_request_attempt (attempt_id, exp_req_id, expert_id, consent_id, response, responded_at)
  VALUES (1, 1, 5, 1, 'declined', CURRENT_TIMESTAMP);
INSERT INTO expert_connection (attempt_id) VALUES (1);

SELECT 'T23 accepted attempt -> connection, risk notice closed', 'EXPECT OK';
INSERT INTO share_consent (consent_id, exp_req_id, expert_id, scope_text, notice_id, consented_by)
  SELECT 2, 1, 6, '하자 사진 2장 - 위치 - AI 결과 - 현장 기록 - 전문가 판정', notice_id, 3 FROM notice_text WHERE notice_kind = 'share';
INSERT INTO expert_request_attempt (attempt_id, exp_req_id, expert_id, consent_id) VALUES (2, 1, 6, 2);
UPDATE expert_request_attempt SET response = 'accepted', responded_at = CURRENT_TIMESTAMP WHERE attempt_id = 2;
INSERT INTO expert_connection (attempt_id) VALUES (2);
SELECT close_reason AS t23_close_reason FROM risk_notice WHERE verdict_id = 1;

SELECT 'T24 risk notice with two sources', 'EXPECT REJECT';
INSERT INTO risk_notice (case_id, source_kind, result_id, verdict_id) VALUES (1, 'analysis', 1, 1);

SELECT 'T25 duplicate case number', 'EXPECT REJECT';
INSERT INTO defect_case (case_no, owner_id) VALUES ('D-2026-0142', 1);

SELECT 'T26 saved record back to draft', 'EXPECT REJECT';
UPDATE inspection_record SET record_status = 'draft' WHERE record_id = 1;

SELECT 'T27 analysis notice row cannot be referenced as share (composite FK)', 'EXPECT REJECT';
INSERT INTO share_consent (exp_req_id, expert_id, scope_text, notice_id, notice_kind, consented_by)
  SELECT 1, 5, 'x', notice_id, 'analysis', 3 FROM notice_text WHERE notice_kind = 'analysis';

SELECT 'T28 priority item with basis record (BR-DEF-12, evidence path 1)', 'EXPECT OK';
INSERT INTO priority_run (run_id, org_id, requested_by, period_from, period_to, notice_id, external_included, excluded_building_count)
  SELECT 1, 1, 4, '2026-01-01', '2026-12-31', notice_id, FALSE, 0 FROM notice_text WHERE notice_kind = 'priority';
INSERT INTO priority_item (run_id, priority_rank, building_id, location_text, defect_type_code, confidence_level)
  VALUES (1, 1, 1, '3층 북측 외벽', 'crack', 'low');
INSERT INTO priority_item_basis (run_id, priority_rank, record_id) VALUES (1, 1, 1);

SELECT 'T29 basis row pointing to neither record nor external history', 'EXPECT REJECT';
INSERT INTO priority_item_basis (run_id, priority_rank) VALUES (1, 1);

-- 유도 뷰 확인 ---------------------------------------------------------
SELECT 'V1 case rail' AS view_check;
SELECT case_no, stage1_analysis, stage2_record, stage3_verify, stage4_action FROM v_case_progress;
SELECT 'V2 entitlement balance';
SELECT entitlement_id, ent_kind, quota_total, used_count, remaining, is_usable FROM v_entitlement_balance ORDER BY entitlement_id;
SELECT 'V3 G7 pattern gate (threshold NULL -> not passed)';
SELECT building_id, history_count, min_required, passed FROM v_pattern_gate ORDER BY building_id;
SELECT 'V4 masked user';
SELECT user_id, email_masked, name_masked, phone_masked FROM v_user_masked WHERE user_id IN (1,2);
SELECT 'V5 building history';
SELECT building_id, entry_kind, location_text, defect_type_code, outcome FROM v_building_history ORDER BY entry_kind;
SELECT 'V6 access check (enterprise via org)';
SELECT user_id, building_id, access_kind FROM v_access_check ORDER BY user_id, building_id;
SELECT 'V7 expert request status';
SELECT exp_req_id, request_status FROM v_expert_request_status;
