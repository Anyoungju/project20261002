/**
 * Buildcare AI — 컨테이너 없는 운영 (research R21)
 * p3.sumzip.com(nginx, /opt/homebrew/etc/nginx/servers/p03.conf) → http://192.168.0.19:9503
 * 단일 Node 프로세스가 /api · /files · 빌드된 SPA(frontend/dist)를 함께 제공한다.
 *   cd backend && npm run build && cd ../frontend && npm run build
 *   pm2 start deploy/pm2.config.cjs && pm2 save
 */
const path = require('node:path');
module.exports = {
  apps: [
    {
      name: 'buildcare',
      cwd: path.resolve(__dirname, '../backend'),
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.BUILDCARE_PORT ?? '9503',
        COOKIE_SECURE: '1',
      },
      max_memory_restart: '512M',
      out_file: path.resolve(__dirname, '../backend/logs/out.log'),
      error_file: path.resolve(__dirname, '../backend/logs/error.log'),
      time: true,
    },
  ],
};
