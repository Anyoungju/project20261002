# 성능 측정 (T151)

측정: 2026-10-03 02:18 KST · 대상 https://p3.sumzip.com · AI 제공자 `mock` · DB 원격 MariaDB(mis.iptime.org)

## SC-001 분석 요청 → 결과

> DB TIMESTAMP 는 초 단위라 1초 미만 처리는 0~1초로 기록된다.

| 표본 | p50 | p95 | 최대 | 60초 이내 | 실패(G4) 누적 |
|---:|---:|---:|---:|---:|---:|
| 5 | 0.0s | 1.0s | 1.0s | 100% | 1 |

> AI 는 mock(고정 지연 0.6초)이라 이 수치는 품질 판정·저장·DB 왕복 시간이다. Gemini 연동 후 다시 측정한다(타임아웃 45초 + 처리 여유로 60초 목표).

## API p95 (목표 < 500ms) — 배포 주소 경유(nginx → Node → 원격 DB), 각 20회

| API | p50 (ms) | p95 (ms) | 목표 | 응답 |
|---|---:|---:|:--:|:--:|
| `GET /api/auth/me` | 93 | 199 | 충족 | 200 |
| `GET /api/gates` | 45 | 206 | 충족 | 200 |
| `GET /api/buildings` | 138 | 206 | 충족 | 200 |
| `GET /api/buildings/{id}/rail` | 248 | 395 | 충족 | 200 |
| `GET /api/buildings/{id}/history` | 27 | 133 | 충족 | 200 |
| `GET /api/buildings/{id}/repeat-defects` | 29 | 39 | 충족 | 200 |
| `GET /api/buildings/{id}/schedules` | 26 | 41 | 충족 | 200 |
| `GET /api/risk-notices` | 17 | 28 | 충족 | 200 |
| `GET /api/expert-requests` | 15 | 21 | 충족 | 200 |
| `GET /api/me/notifications` | 21 | 33 | 충족 | 200 |

재측정: `cd backend && npx tsx scripts/latency-report.ts`
