/**
 * RBAC 권한 카탈로그 (research R22). 003_rbac_seed.sql 과 같은 목록이어야 한다 — 기동 시 대조한다.
 * 권한은 "무엇을"만 정한다. "어디에"(건물·기업 범위)는 v_access_check 가 정한다.
 */
export const PERMISSIONS = {
  'analysis.create': '하자 사진 분석 요청',
  'analysis.read.own': '본인 분석 결과 조회',
  'entitlement.read.own': '본인 이용권 조회',
  'entitlement.purchase': '이용권 구매',
  'guest.link': '비회원 분석 결과 계정 연결',
  'case.read': '하자 건 조회(소유 또는 건물 권한)',
  'photo.read': '하자 사진 조회(권한 확인 후 서명 URL)',
  'building.list': '권한 범위 건물 목록',
  'building.history.read': '건물 이력·반복 하자 조회',
  'building.bms.sync': '건물관리시스템 동기화 요청',
  'record.create': '현장 점검·보수 기록 작성',
  'record.repair.update': '저장 기록 보수 결과 갱신',
  'verification.read': '검증 대기 목록·상세',
  'verification.judge': '전문가 판정 저장',
  'verification.request_data': '추가 자료 요청',
  'trust_metric.read': 'AI 신뢰도 지표 조회',
  'schedule.manage': '정기점검 일정 관리',
  'schedule.read.assigned': '내 배정 점검',
  'org.dashboard.read': '기업 대시보드',
  'priority.run': '유지관리 우선순위 산출',
  'risk_notice.read': '위험 통지 조회',
  'risk_notice.dismiss': '위험 통지 조치 없음 종료',
  'expert_request.create': '전문가 점검 연결 요청',
  'expert_attempt.respond': '점검 요청 수락·거절',
  'notification.read.own': '내 알림',
  'permission_request.create': '권한 요청 보내기',
  'permission_request.resolve': '권한 요청 처리',
  'building_access.grant': '건물 권한 부여·회수',
  'admin.users.manage': '계정·역할 관리',
  'admin.rbac.manage': '역할-권한 매트릭스 관리',
  'admin.constants.manage': '운영 기준값 관리',
  'admin.notices.manage': '고지 문구 판본 관리',
  'gate_event.read': '게이트 이벤트·감사 로그 조회',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** 운영자에게서 뗄 수 없는 권한 (마지막 관리 경로 보호) */
export const LOCKED_PERMISSIONS: Permission[] = ['admin.users.manage', 'admin.rbac.manage'];

export const BUSINESS_ROLES = ['general', 'facility', 'building', 'enterprise', 'expert'] as const;
export const SYSTEM_ROLES = ['operator'] as const;
export const ALL_ROLES = ['guest', ...BUSINESS_ROLES, ...SYSTEM_ROLES] as const;
export type Role = (typeof ALL_ROLES)[number];

const GUEST: Permission[] = ['analysis.create', 'analysis.read.own', 'entitlement.read.own', 'case.read', 'photo.read'];
const GENERAL: Permission[] = [...GUEST, 'entitlement.purchase', 'guest.link', 'notification.read.own', 'permission_request.create'];

/** 기본 매트릭스 — 003 마이그레이션이 같은 내용을 넣는다. 운영 중 변경은 rbac_role_permission 에서 */
export const DEFAULT_MATRIX: Record<Role, Permission[]> = {
  guest: GUEST,
  general: GENERAL,
  facility: [...GENERAL, 'building.list', 'record.create', 'record.repair.update', 'schedule.read.assigned'],
  building: [
    ...GENERAL,
    'building.list',
    'building.history.read',
    'building.bms.sync',
    'schedule.manage',
    'risk_notice.read',
    'risk_notice.dismiss',
    'expert_request.create',
  ],
  enterprise: [
    ...GENERAL,
    'building.list',
    'building.history.read',
    'org.dashboard.read',
    'priority.run',
    'risk_notice.read',
    'permission_request.resolve',
    'building_access.grant',
  ],
  expert: [
    'case.read',
    'photo.read',
    'verification.read',
    'verification.judge',
    'verification.request_data',
    'trust_metric.read',
    'expert_attempt.respond',
    'notification.read.own',
    'permission_request.create',
  ],
  operator: [...ALL_PERMISSIONS],
};

/** 화면 → 진입 권한 (FR-001 메뉴 = 권한에서 유도). 배열은 "하나라도 있으면" */
export const SCREEN_PERMISSIONS: Record<string, Permission[]> = {
  S2: ['analysis.create'],
  S1: ['entitlement.purchase'],
  S3: ['record.create'],
  S7B: ['schedule.read.assigned'],
  S4: ['verification.read'],
  S5: ['building.history.read'],
  S7A: ['schedule.manage'],
  S8A: ['expert_request.create'],
  S8B: ['expert_attempt.respond'],
  S6: ['org.dashboard.read'],
  ADMIN: ['admin.users.manage', 'building_access.grant', 'permission_request.resolve', 'admin.constants.manage', 'admin.notices.manage'],
};

export function menuFor(perms: Iterable<string>): string[] {
  const set = new Set(perms);
  return Object.entries(SCREEN_PERMISSIONS)
    .filter(([, need]) => need.some((p) => set.has(p)))
    .map(([screen]) => screen);
}
