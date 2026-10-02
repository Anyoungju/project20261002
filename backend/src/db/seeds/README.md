# 시연 시드 (research R23)

```bash
npm run db:seed:dev                    # 시연 계정이 없을 때만 생성
npm run db:seed:dev -- --reset         # 업무 테이블 비우고 다시 (SEED_ALLOW_RESET=1 필요)
npm run db:seed:dev -- --only=us1,rbac # 특정 스토리만 (base 는 항상)
```

| 파일                  | 내용                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `dev_constants.sql`   | 기준값(체험 3회·반복 하자 최소 2건·도래 7일·응답 48시간·신뢰도 0.6), 요금 시연값, 개발 전용 건물 유형 `office`, 선명도 기준 20 |
| `base.ts`             | 조직 2 · 건물 4 · 계정 14 · 건물 권한 · 전문가 분야/가능일                                                                     |
| `stories.ts`          | `seedUs1~Us8` · `seedRbac` — 트리거 순서대로 상태를 만든다                                                                     |
| `lib/seedContext.ts`  | 가드(운영 거부) · 상대 날짜 · 비밀번호 · 상태 전이 헬퍼(`seedAnalysis` · `seedRecord` · `seedVerdict`)                         |
| `lib/photoFactory.ts` | 결정적 합성 사진(정상·어두움·흐림·저해상도) — 저작권·개인정보 없음                                                             |

비밀번호는 `.env` 의 `SEED_DEMO_PASSWORD`(없으면 실행 시 무작위 생성·1회 출력). 화면 동선은 `backend/docs/seed-walkthrough.md`.
