-- 개발·시연 전용 기준값 (research R17). 운영 DB 에는 넣지 않는다.
-- expert_fee_rate · expert_fee_base · retention_days 는 비워 둔다(수수료 미기록 · 자동 삭제 없음).
UPDATE service_constant SET const_value = '3'   WHERE const_key = 'free_trial_count';
UPDATE service_constant SET const_value = '2'   WHERE const_key = 'pattern_min_records';
UPDATE service_constant SET const_value = '7'   WHERE const_key = 'due_soon_days';
UPDATE service_constant SET const_value = '48'  WHERE const_key = 'expert_response_hours';
UPDATE service_constant SET const_value = '0.6' WHERE const_key = 'ai_low_confidence';
UPDATE service_constant SET const_value = NULL  WHERE const_key IN ('expert_fee_rate', 'expert_fee_base', 'retention_days');

-- 요금제 시연 금액(화면 표시용)
UPDATE service_plan SET price_amount = 3000  WHERE plan_code = 'per_analysis';
UPDATE service_plan SET price_amount = 29000 WHERE plan_code = 'monthly';

-- 개발 전용 건물 유형 (DDL 기준 데이터는 apartment 뿐 — research R23)
INSERT INTO building_type_code (building_type_code, building_type_name)
SELECT 'office', '사무시설' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM building_type_code WHERE building_type_code = 'office');

-- G3 선명도 기준: 실제 휴대폰 사진(민무늬 벽)을 과하게 거르지 않도록 시연 환경은 20 (운영자 조정 가능)
UPDATE photo_quality_rule SET threshold = 20 WHERE rule_key = 'min_sharpness';
