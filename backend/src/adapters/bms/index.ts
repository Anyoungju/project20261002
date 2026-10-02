import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env';

/** research R15 — 고객사 건물관리시스템 연동 경계 */
export interface ExternalRecord {
  bmsRecordRef: string;
  occurredOn: string; // YYYY-MM-DD
  locationText: string | null;
  defectTypeCode: string | null;
  summary: string;
}

export interface BmsConnector {
  fetchHistory(bmsRef: string, orgId: number | null, since: string | null): Promise<ExternalRecord[]>;
}

export class BmsError extends Error {}

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400_000);
  return d.toISOString().slice(0, 10);
}

/** 결정적 mock — bms_ref 가 FAIL- 로 시작하거나 MOCK_BMS_FAIL=1 이면 실패 */
export class MockBmsConnector implements BmsConnector {
  async fetchHistory(bmsRef: string): Promise<ExternalRecord[]> {
    await new Promise((r) => setTimeout(r, 150));
    if (env.MOCK_BMS_FAIL || bmsRef.startsWith('FAIL-')) throw new BmsError('건물관리시스템 응답 없음(연결 시간 초과)');
    if (bmsRef === 'HB-A') {
      return [
        {
          bmsRecordRef: `${bmsRef}-2025-118`,
          occurredOn: daysAgo(300),
          locationText: 'B2 주차장 천장',
          defectTypeCode: 'leak',
          summary: '우천 후 천장 누수 - 임시 방수 처리',
        },
        {
          bmsRecordRef: `${bmsRef}-2026-031`,
          occurredOn: daysAgo(140),
          locationText: 'B2 주차장 천장',
          defectTypeCode: 'leak',
          summary: '같은 위치 누수 재발 - 배수 드레인 청소',
        },
        {
          bmsRecordRef: `${bmsRef}-2026-077`,
          occurredOn: daysAgo(60),
          locationText: '옥상 방수층',
          defectTypeCode: 'leak',
          summary: '옥상 방수층 들뜸 점검',
        },
      ];
    }
    // HB-B: 외부 이력 없음 → 내부 기록 1건뿐이라 G7(데이터 부족) 시연
    return [];
  }
}

/** 범용 REST — config/bms/<org_id>.json { url, headers, map:{ref,occurredOn,location,defectType,summary} } */
export class RestBmsConnector implements BmsConnector {
  async fetchHistory(bmsRef: string, orgId: number | null, since: string | null): Promise<ExternalRecord[]> {
    const file = path.resolve(__dirname, '../../../config/bms', `${orgId ?? 'default'}.json`);
    if (!fs.existsSync(file)) throw new BmsError(`연동 설정이 없습니다(${path.basename(file)})`);
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const url = new URL(cfg.url);
    url.searchParams.set('ref', bmsRef);
    if (since) url.searchParams.set('since', since);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const resp = await fetch(url, { headers: cfg.headers ?? {}, signal: ctrl.signal });
      if (!resp.ok) throw new BmsError(`건물관리시스템 오류 ${resp.status}`);
      const arr = (await resp.json()) as any[];
      const m = cfg.map ?? {};
      return arr.map((x) => ({
        bmsRecordRef: String(x[m.ref ?? 'ref']),
        occurredOn: String(x[m.occurredOn ?? 'occurredOn']).slice(0, 10),
        locationText: x[m.location ?? 'location'] ?? null,
        defectTypeCode: x[m.defectType ?? 'defectType'] ?? null,
        summary: String(x[m.summary ?? 'summary'] ?? '').slice(0, 500),
      }));
    } catch (e: any) {
      throw e instanceof BmsError ? e : new BmsError(ctrl.signal.aborted ? '건물관리시스템 응답 시간 초과' : `연동 실패: ${e.message}`);
    } finally {
      clearTimeout(t);
    }
  }
}

let connector: BmsConnector | null = null;
export function bmsConnector(): BmsConnector {
  if (!connector) connector = env.BMS_PROVIDER === 'rest' ? new RestBmsConnector() : new MockBmsConnector();
  return connector;
}
