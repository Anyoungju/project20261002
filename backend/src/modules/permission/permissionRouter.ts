import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/http';
import { requirePermission } from '../../middleware/authorize';
import { exec, query, queryOne } from '../../db/pool';
import { notify } from '../notification/notificationService';

/** FR-003 — G0 블록의 [권한 요청 보내기]. 처리자(권한 부여자)에게 알린다 */
export const permissionRouter = Router();

permissionRouter.post(
  '/',
  requirePermission('permission_request.create'),
  ah(async (req, res) => {
    const body = z
      .object({
        buildingId: z.number().int().positive().optional(),
        orgId: z.number().int().positive().optional(),
        requestedScreen: z.string().min(1).max(10),
      })
      .parse(req.body);
    const userId = req.auth!.userId;
    let orgId = body.orgId ?? null;
    if (body.buildingId) {
      const b = await queryOne<{ org_id: number | null }>('SELECT org_id FROM building WHERE building_id = ?', [body.buildingId]);
      if (!b) {
        res.status(404).json({ code: 'not_found', message: '건물을 찾을 수 없습니다' });
        return;
      }
      orgId = orgId ?? b.org_id;
    }
    // 같은 대상의 열린 요청이 있으면 새로 만들지 않는다
    const open = await queryOne<{ perm_req_id: number }>(
      `SELECT perm_req_id FROM permission_request
        WHERE requester_id = ? AND resolution IS NULL AND requested_screen = ?
          AND (building_id <=> ?) AND (org_id <=> ?) LIMIT 1`,
      [userId, body.requestedScreen, body.buildingId ?? null, orgId],
    );
    let id = open?.perm_req_id;
    if (!id) {
      const r = await exec('INSERT INTO permission_request (requester_id, building_id, org_id, requested_screen) VALUES (?, ?, ?, ?)', [
        userId,
        body.buildingId ?? null,
        orgId,
        body.requestedScreen,
      ]);
      id = r.insertId;
      // 수신자: 해당 조직 기업 관리자, 없으면 운영자 (스펙 Assumptions "권한 부여자")
      const recipients = await query<{ user_id: number }>(
        orgId
          ? `SELECT u.user_id FROM user_account u JOIN user_role r ON r.user_id = u.user_id AND r.role_code = 'enterprise' WHERE u.org_id = ?
             UNION SELECT user_id FROM user_system_role WHERE role_code = 'operator'`
          : `SELECT user_id FROM user_system_role WHERE role_code = 'operator'`,
        orgId ? [orgId] : [],
      );
      for (const r2 of recipients) {
        await notify(
          r2.user_id,
          'permission_request',
          { kind: 'permission_request', id },
          '새 권한 요청이 도착했습니다',
          '/admin/permission-requests',
        );
      }
    }
    res.status(201).json({ permReqId: id, status: 'pending' });
  }),
);
