import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { env, isProd } from './config/env';
import { authenticate } from './middleware/authenticate';
import { csrf } from './middleware/csrf';
import { errorHandler } from './middleware/errorHandler';
import { mountApi } from './routes';
import { filesRouter } from './modules/reference/referenceRouter';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // nginx(p1.sumzip.com) 뒤

  // 보안 헤더 (T035)
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID().slice(0, 8);
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    );
    if (isProd || env.COOKIE_SECURE) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(cookieParser());
  app.use(authenticate);
  app.use(csrf);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, at: new Date().toISOString() });
  });
  mountApi(app);
  app.use('/files', filesRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'not_found', message: '없는 API 입니다' });
  });

  // 운영: 빌드된 SPA 를 같은 포트에서 제공(p1.sumzip.com → :9501)
  const dist = path.resolve(__dirname, '..', env.FRONTEND_DIST ?? '../frontend/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, p) => {
          if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get(/^\/(?!api\/|files\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
