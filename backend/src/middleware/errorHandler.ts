import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { GateBlockError, buildBlock } from '../gates/gateBlock';
import { mapSqlError } from '../gates/sqlErrorMap';
import { HttpError } from '../lib/http';

export const errorHandler: ErrorRequestHandler = async (err, req, res, _next) => {
  if (res.headersSent) return;
  const requestId = (req as any).requestId;

  if (err instanceof GateBlockError) {
    res.status(err.status).json(err.block);
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message, requestId, ...(err.extra ?? {}) });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      code: 'validation_failed',
      message: '입력값을 확인해 주세요',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      requestId,
    });
    return;
  }
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ code: 'too_large', message: '파일이 너무 큽니다(장당 15MB 이하)', requestId });
    return;
  }
  if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(422).json({ code: 'too_many_files', message: '사진은 최대 10장까지 올릴 수 있습니다', requestId });
    return;
  }
  // 트리거·CHECK 위반 → 게이트 사상 (sqlErrorMap 단일 지점)
  const mapped = mapSqlError(err);
  if (mapped) {
    if (mapped.gate) {
      try {
        const block = await buildBlock(mapped.gate, { reason: undefined, record: false });
        res.status(mapped.status).json(block);
        return;
      } catch {
        /* fallthrough */
      }
    }
    res.status(mapped.status).json({ code: mapped.code, message: '요청을 처리할 수 없습니다', requestId });
    if (mapped.status >= 500) console.error(`[error] ${requestId} ${mapped.detail}`);
    return;
  }
  console.error(`[error] ${requestId}`, err);
  res.status(500).json({ code: 'internal', message: '서버 오류가 발생했습니다', requestId });
};
