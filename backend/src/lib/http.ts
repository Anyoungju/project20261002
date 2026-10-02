import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { z, ZodSchema } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'bad_request') => new HttpError(400, code, message);
export const notFound = (message = '대상을 찾을 수 없습니다') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message);
export const unprocessable = (message: string, code = 'unprocessable', extra?: Record<string, unknown>) =>
  new HttpError(422, code, message, extra);

/** async 핸들러 오류를 errorHandler 로 넘긴다 */
export function ah(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  return schema.parse(body);
}

export const idParam = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('잘못된 식별자입니다', 'invalid_id');
  return n;
};

export { z };
