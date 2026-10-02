# 배포 — 컨테이너 없음 (research R21)

| 구간 | 값 |
|---|---|
| 공개 주소 | https://p3.sumzip.com |
| 리버스 프록시 | 서버의 nginx `/opt/homebrew/etc/nginx/servers/p03.conf` (기존 설정, 변경 없음) — `https://p3.sumzip.com → http://192.168.0.19:9503`, HTTP→HTTPS 리다이렉트 |
| 앱 프로세스 | pm2 `buildcare` — `backend/dist/server.js` · 포트 **9503** · `/api` · `/files` · SPA(`frontend/dist`) 동시 제공 |
| DB | 원격 MariaDB `mis.iptime.org:13306/ABC11pioneer3` (접속 정보는 `backend/.env`) |

## 절차

```bash
cd backend  && npm ci && npm run build      # dist/ + SQL 자산
npm run db:check && npm run db:migrate      # 멱등
cd ../frontend && npm ci && npm run build   # dist/
cd .. && pm2 start deploy/pm2.config.cjs && pm2 save
curl -s https://p3.sumzip.com/api/health
```

갱신: `npm run build`(양쪽) → `pm2 restart buildcare`.

## 주의

- p03.conf 에 `client_max_body_size` 가 없어 nginx 기본 본문 한도(1MB)가 적용된다. 프런트가 업로드 전에 사진을 긴 변 1600px·약 0.9MB 이하 JPEG 로 줄여 보낸다(`shrinkImage`). 원본 그대로 큰 파일을 올려야 한다면 서버 관리자가 p03.conf 에 `client_max_body_size 20m;` 을 추가해야 한다.
- 운영(`NODE_ENV=production`)에서는 시드 스크립트가 실행을 거부한다. 시연 데이터는 개발 모드에서 `npm run db:seed:dev -- --reset` 로 만든다.
- 세션 쿠키는 HTTPS 전용(`COOKIE_SECURE=1`). 9503 을 http 로 직접 열면 로그인 쿠키가 저장되지 않는다 — 반드시 p3.sumzip.com(HTTPS)으로 접속한다.
