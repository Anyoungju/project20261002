/** 관리 화면 공용 표시 문구 */
export const ROLE_LABEL: Record<string, string> = {
  guest: '비회원',
  general: '일반 사용자',
  facility: '시설관리자',
  building: '건물관리자',
  enterprise: '기업 관리자',
  expert: '전문가',
  operator: '운영자',
};
export const BUSINESS_ROLES = ['general', 'facility', 'building', 'enterprise', 'expert'] as const;

export const ACCESS_LABEL: Record<string, string> = { record: '현장 기록', manage: '건물 관리' };

export const SCREEN_LABEL: Record<string, string> = {
  S1: '이용권 구매',
  S2: '하자 분석',
  S3: '현장 기록',
  S4: '전문가 검증',
  S5: '건물 이력',
  S6: '유지관리 우선순위',
  S7A: '정기점검 일정',
  S7B: '내 배정 점검',
  S8A: '전문가 점검 요청',
  S8B: '점검 요청 응답',
  ADMIN: '관리',
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'user.create': '계정 생성',
  'user.roles': '역할 변경',
  'user.disable': '계정 비활성화',
  'user.enable': '계정 활성화',
  'user.reset_password': '비밀번호 초기화',
  'access.grant': '건물 권한 부여',
  'access.revoke': '건물 권한 회수',
  'permreq.granted': '권한 요청 승인',
  'permreq.rejected': '권한 요청 거절',
  'rbac.role_permissions': '역할 권한 변경',
  'constant.set': '기준값 변경',
  'plan.price': '요금 변경',
  'notice.add': '고지 판본 추가',
};

export const NOTICE_KIND_LABEL: Record<string, string> = {
  analysis: '분석 결과 고지',
  priority: '우선순위 고지',
  share: '자료 공유·수수료 고지',
};

export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;
