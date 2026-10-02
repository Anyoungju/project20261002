import { exec, query, Db, getPool } from '../db/pool';

export type GateCode = 'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8' | 'G9' | 'G10';

export interface GateAction {
  id: string;
  label: string;
  href?: string;
}

export interface GateBlock {
  gate: GateCode;
  message: string;
  reason?: string;
  releaseParty: string;
  selfRelease: boolean;
  actions: GateAction[];
  missingFields?: string[];
  gateEventId?: number;
}

/** 계약 openapi.yaml 상단 상태코드표 */
export const GATE_HTTP: Record<GateCode, number> = {
  G0: 403,
  G1: 402,
  G2: 402,
  G3: 422,
  G4: 502,
  G5: 422,
  G6: 409,
  G7: 200,
  G8: 409,
  G9: 409,
  G10: 409,
};

/** FR-006: 해제 주체가 현재 사용자가 아닌 게이트는 «요청 보내기»만 */
const NOT_SELF: GateCode[] = ['G0', 'G6', 'G7', 'G10'];

type GateDefRow = { gate_code: GateCode; gate_name: string; block_message: string; release_party: string };
let cache: Map<GateCode, GateDefRow> | null = null;

export async function loadGateDefs(force = false): Promise<Map<GateCode, GateDefRow>> {
  if (!cache || force) {
    const rows = await query<GateDefRow>('SELECT gate_code, gate_name, block_message, release_party FROM gate_def');
    cache = new Map(rows.map((r) => [r.gate_code, r]));
  }
  return cache;
}

export type GateSubjectKind =
  | 'user_account'
  | 'building'
  | 'organization'
  | 'payment'
  | 'analysis_request'
  | 'inspection_record'
  | 'verification_item'
  | 'expert_request'
  | 'expert_request_attempt';

export interface BlockOptions {
  reason?: string;
  actions?: GateAction[];
  missingFields?: string[];
  actorId?: number | null;
  subject?: { kind: GateSubjectKind; id: number };
  /** HTTP 상태 재정의(G0 미로그인 401 등) */
  status?: number;
  /** G0 이 "로그인 필요"일 때 — 본인이 해제 가능 */
  selfRelease?: boolean;
  record?: boolean;
}

export class GateBlockError extends Error {
  constructor(
    public block: GateBlock,
    public status: number,
  ) {
    super(`${block.gate}: ${block.message}`);
  }
}

/** FR-007: 게이트 발생을 gate_event 로 남기고 GateBlock 을 만든다. 문구는 gate_def 단일 원천 */
export async function buildBlock(gate: GateCode, opts: BlockOptions = {}, db: Db = getPool()): Promise<GateBlock> {
  const defs = await loadGateDefs();
  const def = defs.get(gate);
  if (!def) throw new Error(`gate_def 에 ${gate} 가 없습니다`);
  let gateEventId: number | undefined;
  if (opts.subject && opts.record !== false) {
    const res = await exec(
      'INSERT INTO gate_event (gate_code, actor_id, subject_kind, subject_id, reason_text) VALUES (?, ?, ?, ?, ?)',
      [gate, opts.actorId ?? null, opts.subject.kind, opts.subject.id, opts.reason?.slice(0, 300) ?? null],
      db,
    );
    gateEventId = res.insertId;
  }
  return {
    gate,
    message: def.block_message,
    reason: opts.reason,
    releaseParty: def.release_party,
    selfRelease: opts.selfRelease ?? !NOT_SELF.includes(gate),
    actions: opts.actions ?? [],
    ...(opts.missingFields ? { missingFields: opts.missingFields } : {}),
    ...(gateEventId ? { gateEventId } : {}),
  };
}

export async function gateError(gate: GateCode, opts: BlockOptions = {}, db?: Db): Promise<GateBlockError> {
  const block = await buildBlock(gate, opts, db);
  return new GateBlockError(block, opts.status ?? GATE_HTTP[gate]);
}

/** 게이트 해제 기록 (FR-007) */
export async function releaseGates(
  subject: { kind: GateSubjectKind; id: number },
  gate: GateCode | GateCode[],
  releasedBy: number | null,
  action: string,
  db: Db = getPool(),
): Promise<void> {
  const gates = Array.isArray(gate) ? gate : [gate];
  await exec(
    `UPDATE gate_event SET released_at = CURRENT_TIMESTAMP, released_by = ?, release_action = ?
      WHERE subject_kind = ? AND subject_id = ? AND gate_code IN (?) AND released_at IS NULL`,
    [releasedBy, action.slice(0, 100), subject.kind, subject.id, gates],
    db,
  );
}
