import { describe, it, expect } from 'vitest';
import { DEFAULT_MATRIX, ALL_PERMISSIONS, LOCKED_PERMISSIONS, menuFor, PERMISSIONS } from '../../src/auth/permissions';
import { permissionsFor } from '../../src/auth/rbacService';

const matrix = new Map(Object.entries(DEFAULT_MATRIX).map(([r, p]) => [r, new Set(p as string[])]));

describe('RBAC 기본 매트릭스 (research R22)', () => {
  it('매트릭스의 모든 권한은 카탈로그에 있다', () => {
    for (const perms of Object.values(DEFAULT_MATRIX)) for (const p of perms) expect(PERMISSIONS).toHaveProperty(p);
  });
  it('운영자는 모든 권한, 잠금 권한 포함', () => {
    expect(new Set(DEFAULT_MATRIX.operator)).toEqual(new Set(ALL_PERMISSIONS));
    for (const l of LOCKED_PERMISSIONS) expect(DEFAULT_MATRIX.operator).toContain(l);
  });
  it('비회원은 분석만 — 구매·관리 불가 (FR-120)', () => {
    const g = permissionsFor(['guest'], matrix);
    expect(g.has('analysis.create')).toBe(true);
    expect(g.has('entitlement.purchase')).toBe(false);
    expect([...g].some((p) => p.startsWith('admin.'))).toBe(false);
  });
  it('전문가 연결 요청은 건물관리자만 (FR-121)', () => {
    for (const r of ['guest', 'general', 'facility', 'enterprise', 'expert']) {
      expect(permissionsFor([r], matrix).has('expert_request.create')).toBe(false);
    }
    expect(permissionsFor(['building'], matrix).has('expert_request.create')).toBe(true);
  });
  it('시설관리자는 일반 사용자 분석 기능을 상속 (FR-001)', () => {
    expect(permissionsFor(['facility'], matrix).has('analysis.create')).toBe(true);
  });
  it('다중 역할은 합집합', () => {
    const p = permissionsFor(['facility', 'building'], matrix);
    expect(p.has('record.create') && p.has('schedule.manage')).toBe(true);
  });
  it('메뉴는 권한에서 유도 (FR-001)', () => {
    expect(menuFor(permissionsFor(['general'], matrix))).toEqual(['S2', 'S1']);
    expect(menuFor(permissionsFor(['expert'], matrix))).toEqual(['S4', 'S8B']);
    expect(menuFor(permissionsFor(['building'], matrix))).toEqual(expect.arrayContaining(['S5', 'S7A', 'S8A']));
    expect(menuFor(permissionsFor(['enterprise'], matrix))).toEqual(expect.arrayContaining(['S6', 'ADMIN']));
  });
});
