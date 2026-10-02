import { Router } from 'express';
import { ah, idParam, notFound, badRequest } from '../../lib/http';
import { requirePermission, assertCaseAccess, forbidden, canAccessCase } from '../../middleware/authorize';
import { queryOne } from '../../db/pool';
import { caseProgress, caseSummary } from './caseService';
import { signFileUrl } from '../../adapters/storage';

export const caseRouter = Router();

caseRouter.get(
  '/:caseId',
  requirePermission('case.read'),
  ah(async (req, res) => {
    const id = idParam(req.params.caseId);
    await assertCaseAccess(req, id);
    const s = await caseSummary(id);
    if (!s) throw notFound();
    res.json(s);
  }),
);

caseRouter.get(
  '/:caseId/progress',
  requirePermission('case.read'),
  ah(async (req, res) => {
    const id = idParam(req.params.caseId);
    await assertCaseAccess(req, id);
    const p = await caseProgress(id);
    if (!p) throw notFound();
    res.json(p);
  }),
);

/** FR-091 — 권한 확인 후 5분 서명 URL */
export const photoRouter = Router();
photoRouter.get(
  '/:kind/:photoId/url',
  requirePermission('photo.read'),
  ah(async (req, res) => {
    const kind = req.params.kind;
    const id = idParam(req.params.photoId);
    let row: { storage_key: string; case_id: number } | null = null;
    if (kind === 'analysis') {
      row = await queryOne(
        'SELECT p.storage_key, q.case_id FROM analysis_photo p JOIN analysis_request q ON q.request_id = p.request_id WHERE p.photo_id = ?',
        [id],
      );
    } else if (kind === 'record') {
      row = await queryOne(
        'SELECT p.storage_key, r.case_id FROM record_photo p JOIN inspection_record r ON r.record_id = p.record_id WHERE p.photo_id = ?',
        [id],
      );
    } else throw badRequest('kind 는 analysis 또는 record');
    if (!row) throw notFound('사진을 찾을 수 없습니다');
    if (!(await canAccessCase(req, row.case_id))) throw await forbidden(req, '이 사진을 볼 권한이 없습니다');
    res.json(signFileUrl(row.storage_key));
  }),
);
