import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedFixture, done, as, getApp, Client, email, Fixture } from './helpers';
import { exec } from '../../src/db/pool';

let fx: Fixture;
beforeAll(async () => {
  fx = await seedFixture();
});
afterAll(() => done());

describe('인증 (R10 · R22)', () => {
  it('로그인 성공 시 마스킹된 me + 권한 유도 메뉴', async () => {
    const c = await as('general');
    const me = (await c.get('/api/auth/me')).body;
    expect(me.emailMasked).toBe('***@***.local');
    expect(me.nameMasked).toMatch(/\*\*$/);
    expect(me.menu).toEqual(['S2', 'S1']);
    expect(JSON.stringify(me)).not.toContain('@test.buildcare.local');
  });

  it('CSRF 토큰 없는 상태 변경은 403', async () => {
    const c = await as('general');
    const r = await c.agent.post('/api/auth/logout');
    expect(r.status).toBe(403);
  });

  it('5회 실패하면 잠긴다(423)', async () => {
    const c = await new Client(await getApp()).init();
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/api/auth/login', { email: email('general2'), password: 'wrong-password-1' });
      expect(r.status).toBe(401);
    }
    const r = await c.post('/api/auth/login', { email: email('general2'), password: 'TestPassw0rd!' });
    expect(r.status).toBe(423);
  });

  it('비밀번호 변경·비활성화 시 기존 세션은 즉시 401 (token_version)', async () => {
    const a = await as('expert');
    expect((await a.get('/api/verification-items')).status).toBe(200);
    await exec('UPDATE user_credential SET token_version = token_version + 1 WHERE user_id = ?', [fx.users.expert]);
    const r = await a.get('/api/verification-items');
    expect(r.status).toBe(401);
    expect(r.body.gate).toBe('G0');
  });
});

describe('RBAC 매트릭스 — 역할 × 보호 라우트 (SC-016)', () => {
  const routes: Array<[string, string, Record<string, number>]> = [
    // [method path, 설명, 역할별 기대 상태]
    ['GET /api/records', 'S3', { general: 403, facility: 200, building: 403, expert: 403, enterprise: 403, operator: 200 }],
    ['GET /api/verification-items', 'S4', { general: 403, facility: 403, building: 403, expert: 200, operator: 200 }],
    ['GET /api/me/assignments', 'S7B', { general: 403, facility: 200, building: 403, expert: 403 }],
    ['GET /api/risk-notices', 'S8A', { general: 403, facility: 403, building: 200, enterprise: 200, expert: 403 }],
    ['GET /api/expert-requests', 'S8A', { general: 403, facility: 403, building: 200, enterprise: 403 }],
    ['GET /api/me/expert-attempts', 'S8B', { general: 403, building: 403, expert: 200 }],
    ['GET /api/org/dashboard', 'S6', { general: 403, building: 403, enterprise: 200 }],
    ['GET /api/admin/users', 'ADMIN', { general: 403, building: 403, enterprise: 200, operator: 200 }],
    ['GET /api/admin/constants', 'ADMIN', { enterprise: 403, operator: 200 }],
    ['GET /api/admin/rbac/matrix', 'ADMIN', { general: 403, operator: 200 }],
  ];
  for (const [route, screen, expected] of routes) {
    for (const [role, status] of Object.entries(expected)) {
      it(`${role} → ${route} = ${status}`, async () => {
        const c = await as(role);
        const [, path] = route.split(' ');
        const r = await c.get(path);
        expect(r.status).toBe(status);
        if (status === 403) {
          expect(r.body.gate).toBe('G0');
          expect(r.body.selfRelease).toBe(false);
          expect(r.body.actions[0].id).toBe('permission-request');
        }
      });
    }
    void screen;
  }

  it('미로그인은 401 G0 + 로그인 행동', async () => {
    const c = await new Client(await getApp()).init();
    const r = await c.get('/api/records');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ gate: 'G0', selfRelease: true });
  });

  it('권한 밖 건물은 목록에 없고 직접 접근은 403 (FR-003)', async () => {
    const b = await as('building');
    const list = (await b.get('/api/buildings')).body.map((x: any) => x.buildingId);
    expect(list).toEqual(expect.arrayContaining([fx.buildings.A, fx.buildings.B]));
    expect(list).not.toContain(fx.buildings.X);
    const r = await b.get(`/api/buildings/${fx.buildings.X}/history`);
    expect(r.status).toBe(403);
    expect(r.body.gate).toBe('G0');
  });

  it('기업 관리자는 소속 조직 건물 전체를 자동으로 본다(v_access_check)', async () => {
    const e = await as('enterprise');
    const ids = (await e.get('/api/buildings')).body.map((x: any) => x.buildingId);
    expect(ids).toEqual(expect.arrayContaining([fx.buildings.A, fx.buildings.B]));
    expect(ids).not.toContain(fx.buildings.X);
  });
});

describe('RBAC 관리 (Phase 5)', () => {
  it('기업 관리자는 타 조직 건물 권한을 줄 수 없다', async () => {
    const e = await as('enterprise');
    const r = await e.post(`/api/admin/users/${fx.users.facility}/building-access`, { buildingId: fx.buildings.X, accessKind: 'record' });
    expect(r.status).toBe(403);
  });

  it('권한 요청 → 운영자 승인 → 재로그인 없이 접근 가능, 감사 로그 기록', async () => {
    const g = await as('general');
    // general 에게 facility 역할을 주고(운영자) 건물 X 권한 요청 → 승인
    const op = await as('operator');
    expect((await op.put(`/api/admin/users/${fx.users.general}/roles`, { roles: ['general', 'facility'] })).status).toBe(200);
    const g2 = await as('general'); // 역할 변경으로 기존 세션은 무효
    expect((await g.get('/api/auth/me')).status).toBe(401);
    expect((await g2.get(`/api/buildings/${fx.buildings.X}/rail`)).status).toBe(403);
    const pr = await g2.post('/api/permission-requests', { buildingId: fx.buildings.X, requestedScreen: 'S3' });
    expect(pr.status).toBe(201);
    const list = (await op.get('/api/admin/permission-requests')).body;
    expect(list.some((x: any) => x.permReqId === pr.body.permReqId)).toBe(true);
    expect(
      (await op.post(`/api/admin/permission-requests/${pr.body.permReqId}`, { resolution: 'granted', accessKind: 'record' })).status,
    ).toBe(200);
    expect((await g2.get(`/api/buildings/${fx.buildings.X}/rail`)).status).toBe(200);
    const audit = (await op.get('/api/admin/audit-log')).body;
    expect(audit.some((a: any) => a.action === 'permreq.granted')).toBe(true);
  });

  it('운영자에게서 잠금 권한은 뗄 수 없다', async () => {
    const op = await as('operator');
    const m = (await op.get('/api/admin/rbac/matrix')).body;
    const without = m.grants.operator.filter((p: string) => p !== 'admin.rbac.manage');
    expect((await op.put('/api/admin/rbac/roles/operator/permissions', { permissions: without })).status).toBe(409);
  });
});
