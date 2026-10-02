import fs from 'node:fs';
import { Router } from 'express';
import { ah } from '../../lib/http';
import { query, queryOne, Db, getPool } from '../../db/pool';
import { storage, verifyFileToken } from '../../adapters/storage';

export const referenceRouter = Router();

/** FR-005 — 게이트 문구 단일 원천 */
referenceRouter.get(
  '/gates',
  ah(async (_req, res) => {
    const rows = await query(
      'SELECT gate_code, gate_name, block_message, release_party FROM gate_def ORDER BY CAST(SUBSTRING(gate_code, 2) AS UNSIGNED)',
    );
    res.json(
      rows.map((r) => ({ gateCode: r.gate_code, gateName: r.gate_name, blockMessage: r.block_message, releaseParty: r.release_party })),
    );
  }),
);

referenceRouter.get(
  '/codes',
  ah(async (_req, res) => {
    const defect = await query('SELECT defect_type_code AS code, defect_type_name AS name FROM defect_type_code ORDER BY code');
    const building = await query('SELECT building_type_code AS code, building_type_name AS name FROM building_type_code ORDER BY code');
    res.json({
      defectTypes: defect,
      buildingTypes: building,
      specialties: [
        { code: 'architecture', name: '건축' },
        { code: 'structure', name: '구조' },
        { code: 'waterproof', name: '방수' },
      ],
      cycles: [
        { code: 'month', name: '월' },
        { code: 'quarter', name: '분기' },
        { code: 'half', name: '반기' },
        { code: 'year', name: '연' },
      ],
    });
  }),
);

export interface NoticeDto {
  noticeId: number;
  kind: string;
  body: string;
  effectiveFrom: string;
}

/** 현재 판본 = 가장 최근 effective_from (FR-018 판본으로만 추가) */
export async function currentNotice(kind: 'analysis' | 'priority' | 'share', db: Db = getPool()): Promise<NoticeDto> {
  const r = await queryOne<{ notice_id: number; notice_kind: string; body: string; effective_from: string }>(
    `SELECT notice_id, notice_kind, body, effective_from FROM notice_text
      WHERE notice_kind = ? AND effective_from <= CURRENT_TIMESTAMP ORDER BY effective_from DESC, notice_id DESC LIMIT 1`,
    [kind],
    db,
  );
  if (!r) throw new Error(`notice_text 에 ${kind} 판본이 없습니다`);
  return { noticeId: r.notice_id, kind: r.notice_kind, body: r.body, effectiveFrom: r.effective_from };
}

export async function noticeById(id: number, db: Db = getPool()): Promise<NoticeDto | null> {
  const r = await queryOne<{ notice_id: number; notice_kind: string; body: string; effective_from: string }>(
    'SELECT notice_id, notice_kind, body, effective_from FROM notice_text WHERE notice_id = ?',
    [id],
    db,
  );
  return r ? { noticeId: r.notice_id, kind: r.notice_kind, body: r.body, effectiveFrom: r.effective_from } : null;
}

referenceRouter.get(
  '/notices/current',
  ah(async (_req, res) => {
    res.json({
      analysis: await currentNotice('analysis'),
      priority: await currentNotice('priority'),
      share: await currentNotice('share'),
    });
  }),
);

/** R12 — 서명 URL 로만 파일 제공 */
export const filesRouter = Router();
filesRouter.get(
  '/:token',
  ah(async (req, res) => {
    const key = verifyFileToken(req.params.token);
    if (!key) {
      res.status(403).json({ code: 'file_link_expired', message: '사진 링크가 만료되었습니다 - 화면을 새로고침해 주세요' });
      return;
    }
    const p = storage.absolutePath(key);
    if (!fs.existsSync(p)) {
      res.status(404).json({ code: 'not_found', message: '사진을 찾을 수 없습니다' });
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    fs.createReadStream(p).pipe(res);
  }),
);
