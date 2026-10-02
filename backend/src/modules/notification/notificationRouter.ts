import { Router } from 'express';
import { ah, idParam } from '../../lib/http';
import { requirePermission } from '../../middleware/authorize';
import { exec, query, queryOne } from '../../db/pool';

export const notificationRouter = Router();

notificationRouter.get(
  '/',
  requirePermission('notification.read.own'),
  ah(async (req, res) => {
    const rows = await query(
      `SELECT notif_id, kind, ref_kind, ref_id, title, link, created_at, read_at
         FROM notification WHERE recipient_id = ? ORDER BY created_at DESC, notif_id DESC LIMIT 100`,
      [req.auth!.userId],
    );
    const unread = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM notification WHERE recipient_id = ? AND read_at IS NULL', [
      req.auth!.userId,
    ]);
    res.json({
      unreadCount: unread?.n ?? 0,
      items: rows.map((r) => ({
        notifId: r.notif_id,
        kind: r.kind,
        refKind: r.ref_kind,
        refId: r.ref_id,
        title: r.title,
        link: r.link,
        createdAt: r.created_at,
        readAt: r.read_at,
      })),
    });
  }),
);

notificationRouter.post(
  '/:notifId/read',
  requirePermission('notification.read.own'),
  ah(async (req, res) => {
    await exec('UPDATE notification SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE notif_id = ? AND recipient_id = ?', [
      idParam(req.params.notifId),
      req.auth!.userId,
    ]);
    res.status(204).end();
  }),
);
