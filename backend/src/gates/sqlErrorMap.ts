import type { GateCode } from './gateBlock';

/**
 * 트리거 SIGNAL 45000 / CHECK(4025) → 게이트·HTTP 사상. **이 파일 한 곳에서만** 한다(CLAUDE.md · data-model §5).
 */
export interface MappedSqlError {
  gate?: GateCode;
  status: number;
  code: string;
  detail: string;
}

const SIGNAL_PREFIXES: Array<{ prefix: string; gate?: GateCode; status: number; code: string }> = [
  { prefix: 'G1:', gate: 'G1', status: 402, code: 'payment_not_approved' },
  { prefix: 'G2:', gate: 'G2', status: 402, code: 'entitlement_required' },
  { prefix: 'G3/G4:', gate: 'G4', status: 502, code: 'result_without_analysis' },
  { prefix: 'G6:', gate: 'G6', status: 409, code: 'open_data_request' },
  { prefix: 'G10:', gate: 'G10', status: 409, code: 'connection_requires_acceptance' },
  { prefix: 'BR-DEF-03:', status: 422, code: 'photo_required' },
  { prefix: 'UC3 E4:', gate: 'G5', status: 422, code: 'record_photo_required' },
  { prefix: 'UC3: record must start', status: 422, code: 'record_must_start_draft' },
  { prefix: 'UC3: saved record', status: 409, code: 'saved_record_immutable' },
  { prefix: 'P7:', status: 422, code: 'schedule_completion_invalid' },
];

export function mapSqlError(err: any): MappedSqlError | null {
  if (!err || typeof err !== 'object') return null;
  const errno: number | undefined = err.errno;
  const message: string = err.sqlMessage ?? err.message ?? '';
  if (err.sqlState === '45000' || errno === 1644) {
    const hit = SIGNAL_PREFIXES.find((p) => message.startsWith(p.prefix));
    if (hit) return { gate: hit.gate, status: hit.status, code: hit.code, detail: message };
    return { status: 422, code: 'rule_violation', detail: message };
  }
  if (errno === 4025) {
    // CHECK constraint `x` failed
    const m = /CONSTRAINT `([^`]+)`/.exec(message);
    const name = m?.[1] ?? 'check';
    if (name === 'chk_rec_required_on_save') return { gate: 'G5', status: 422, code: name, detail: message };
    return { status: 422, code: name, detail: message };
  }
  if (errno === 1062) return { status: 409, code: 'duplicate', detail: message };
  if (errno === 1451 || errno === 1452) return { status: 409, code: 'reference_violation', detail: message };
  if (errno === 1442) return { status: 500, code: 'trigger_table_conflict', detail: message };
  return null;
}
