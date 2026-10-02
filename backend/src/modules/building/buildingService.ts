import { exec, query, queryOne, withTransaction } from '../../db/pool';
import { bmsConnector } from '../../adapters/bms';
import { buildBlock } from '../../gates/gateBlock';
import { resultDto, recordPhotos, analysisPhotos } from '../case/caseService';
import { maskedUsers } from '../../lib/mask';

/** FR-050 — 권한 범위 건물만 (v_access_check) */
export async function listBuildings(userId: number, access?: 'record' | 'manage') {
  const rows = await query<{
    building_id: number;
    building_name: string;
    building_type_code: string;
    building_type_name: string;
    org_id: number | null;
    org_name: string | null;
    kinds: string;
  }>(
    `SELECT b.building_id, b.building_name, b.building_type_code, t.building_type_name, b.org_id, o.org_name,
            GROUP_CONCAT(DISTINCT a.access_kind ORDER BY a.access_kind) AS kinds
       FROM v_access_check a
       JOIN building b ON b.building_id = a.building_id
       JOIN building_type_code t ON t.building_type_code = b.building_type_code
       LEFT JOIN organization o ON o.org_id = b.org_id
      WHERE a.user_id = ? ${access ? 'AND a.access_kind = ?' : ''}
      GROUP BY b.building_id, b.building_name, b.building_type_code, t.building_type_name, b.org_id, o.org_name
      ORDER BY b.building_name`,
    access ? [userId, access] : [userId],
  );
  return rows.map((r) => ({
    buildingId: r.building_id,
    buildingName: r.building_name,
    buildingTypeCode: r.building_type_code,
    buildingTypeName: r.building_type_name,
    orgId: r.org_id,
    orgName: r.org_name,
    access: r.kinds.split(','),
  }));
}

export async function buildingInfo(buildingId: number) {
  const b = await queryOne<{
    building_id: number;
    building_name: string;
    building_type_code: string;
    building_type_name: string;
    org_id: number | null;
    bms_ref: string | null;
  }>(
    `SELECT b.building_id, b.building_name, b.building_type_code, t.building_type_name, b.org_id, b.bms_ref
       FROM building b JOIN building_type_code t ON t.building_type_code = b.building_type_code WHERE b.building_id = ?`,
    [buildingId],
  );
  return b
    ? {
        buildingId: b.building_id,
        buildingName: b.building_name,
        buildingTypeCode: b.building_type_code,
        buildingTypeName: b.building_type_name,
        orgId: b.org_id,
        hasBms: !!b.bms_ref,
      }
    : null;
}

/** C1 building rail — v_building_rail + 저장 기록 요약 */
export async function buildingRail(buildingId: number) {
  const r = await queryOne<{
    building_id: number;
    building_name: string;
    history_count: number;
    overdue_count: number;
    awaiting_count: number;
  }>('SELECT * FROM v_building_rail WHERE building_id = ?', [buildingId]);
  if (!r) return null;
  // 원격 DB 왕복을 줄이려고 독립 조회는 병렬로 (T151 p95 < 500ms)
  const [byType, pending, last, sync] = await Promise.all([
    query<{ defect_type_code: string; defect_type_name: string; n: number }>(
      `SELECT r.defect_type_code, d.defect_type_name, COUNT(*) AS n FROM inspection_record r
       JOIN defect_type_code d ON d.defect_type_code = r.defect_type_code
      WHERE r.building_id = ? AND r.record_status = 'saved' GROUP BY r.defect_type_code, d.defect_type_name`,
      [buildingId],
    ),
    queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM inspection_record WHERE building_id = ? AND record_status = 'saved' AND repair_status = 'pending'",
      [buildingId],
    ),
    queryOne<{ saved_at: string | null }>(
      "SELECT MAX(saved_at) AS saved_at FROM inspection_record WHERE building_id = ? AND record_status = 'saved'",
      [buildingId],
    ),
    syncState(buildingId),
  ]);
  return {
    buildingId: r.building_id,
    buildingName: r.building_name,
    historyCount: Number(r.history_count),
    overdueCount: Number(r.overdue_count),
    awaitingCount: Number(r.awaiting_count),
    pendingRepairCount: Number(pending?.n ?? 0),
    lastRecordAt: last?.saved_at ?? null,
    byDefectType: byType.map((x) => ({ code: x.defect_type_code, name: x.defect_type_name, count: Number(x.n) })),
    source: sync,
  };
}

/** C7 — v_building_sync_state 단일 지점 */
export async function syncState(buildingId: number) {
  const row = await queryOne<{
    last_sync_status: string | null;
    bms_ref: string | null;
    started_at: string | null;
    error_message: string | null;
  }>(
    `SELECT v.last_sync_status, b.bms_ref,
            (SELECT r.started_at FROM bms_sync_run r WHERE r.building_id = b.building_id ORDER BY r.started_at DESC, r.sync_id DESC LIMIT 1) AS started_at,
            (SELECT r.error_message FROM bms_sync_run r WHERE r.building_id = b.building_id ORDER BY r.started_at DESC, r.sync_id DESC LIMIT 1) AS error_message
       FROM building b JOIN v_building_sync_state v ON v.building_id = b.building_id WHERE b.building_id = ?`,
    [buildingId],
  );
  const s = row ? { last_sync_status: row.last_sync_status } : null;
  const b = row ? { bms_ref: row.bms_ref } : null;
  const last = row?.started_at ? { started_at: row.started_at, error_message: row.error_message } : null;
  return {
    connected: !!b?.bms_ref,
    lastSyncStatus: s?.last_sync_status ?? null,
    lastSyncAt: last?.started_at ?? null,
    externalMissing: !!b?.bms_ref && s?.last_sync_status !== 'ok',
    errorMessage: s?.last_sync_status === 'failed' ? (last?.error_message ?? null) : null,
  };
}

/** R15 · FR-052 — 동기화 1회: bms_sync_run + external_history upsert */
export async function syncBuilding(buildingId: number): Promise<{ status: 'ok' | 'failed' | 'skipped'; added: number; error?: string }> {
  const b = await queryOne<{ bms_ref: string | null; org_id: number | null }>(
    'SELECT bms_ref, org_id FROM building WHERE building_id = ?',
    [buildingId],
  );
  if (!b?.bms_ref) return { status: 'skipped', added: 0 };
  const lastOk = await queryOne<{ d: string | null }>(
    "SELECT DATE(MAX(started_at)) AS d FROM bms_sync_run WHERE building_id = ? AND sync_status = 'ok'",
    [buildingId],
  );
  try {
    const recs = await bmsConnector().fetchHistory(b.bms_ref, b.org_id, null);
    return await withTransaction(async (conn) => {
      const run = await exec("INSERT INTO bms_sync_run (building_id, sync_status) VALUES (?, 'ok')", [buildingId], conn);
      let added = 0;
      for (const x of recs) {
        const r = await exec(
          `INSERT INTO external_history (building_id, sync_id, bms_record_ref, occurred_on, location_text, defect_type_code, summary)
           VALUES (?, ?, ?, ?, ?, (SELECT defect_type_code FROM defect_type_code WHERE defect_type_code = ?), ?)
           ON DUPLICATE KEY UPDATE ext_id = ext_id`,
          [buildingId, run.insertId, x.bmsRecordRef, x.occurredOn, x.locationText, x.defectTypeCode, x.summary],
          conn,
        );
        if (r.affectedRows === 1) added++;
      }
      void lastOk;
      return { status: 'ok' as const, added };
    });
  } catch (e: any) {
    const msg = String(e.message ?? '연동 실패').slice(0, 300);
    await exec("INSERT INTO bms_sync_run (building_id, sync_status, error_message) VALUES (?, 'failed', ?)", [buildingId, msg]);
    return { status: 'failed', added: 0, error: msg };
  }
}

/** 화면 진입 시 마지막 성공 후 1시간 경과면 비동기 동기화(화면은 기다리지 않음) */
export function syncIfStale(buildingId: number): void {
  queryOne<{ ok: number }>(
    `SELECT COUNT(*) AS ok FROM bms_sync_run WHERE building_id = ? AND started_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
    [buildingId],
  )
    .then((r) => {
      if (!r?.ok) return syncBuilding(buildingId);
    })
    .catch((e) => console.error('[bms] stale sync', e.message));
}

export async function syncAllBuildings() {
  const rows = await query<{ building_id: number }>('SELECT building_id FROM building WHERE bms_ref IS NOT NULL');
  const out = [];
  for (const r of rows) out.push({ buildingId: r.building_id, ...(await syncBuilding(r.building_id)) });
  return out;
}

const KIND_LABEL: Record<string, string> = {
  ai_analysis: 'AI 분석',
  field_record: '현장 기록',
  expert_verdict: '전문가 판정',
  expert_connection: '전문가 연결',
  external: '외부 이력',
};

/** FR-051 — v_building_history 시간순 통합(읽기 전용, FR-055) */
export async function buildingHistory(buildingId: number, f: { from?: string; to?: string; defectType?: string; kind?: string }) {
  const where = ['h.building_id = ?'];
  const params: unknown[] = [buildingId];
  if (f.from) {
    where.push('DATE(h.occurred_at) >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('DATE(h.occurred_at) <= ?');
    params.push(f.to);
  }
  if (f.defectType) {
    where.push('h.defect_type_code = ?');
    params.push(f.defectType);
  }
  if (f.kind) {
    where.push('h.entry_kind = ?');
    params.push(f.kind);
  }
  const rows = await query<{
    occurred_at: string;
    entry_kind: string;
    location_text: string | null;
    defect_type_code: string | null;
    defect_type_name: string | null;
    outcome: string | null;
    case_id: number | null;
    case_no: string | null;
    source_id: number;
  }>(
    `SELECT h.occurred_at, h.entry_kind, h.location_text, h.defect_type_code, d.defect_type_name, h.outcome, h.case_id, c.case_no, h.source_id
       FROM v_building_history h
       LEFT JOIN defect_type_code d ON d.defect_type_code = h.defect_type_code
       LEFT JOIN defect_case c ON c.case_id = h.case_id
      WHERE ${where.join(' AND ')}
      ORDER BY h.occurred_at DESC LIMIT 300`,
    params,
  );
  return {
    source: await syncState(buildingId),
    entries: rows.map((r) => ({
      entryKey: `${r.entry_kind}:${r.source_id}`,
      occurredAt: r.occurred_at,
      entryKind: r.entry_kind,
      entryKindLabel: KIND_LABEL[r.entry_kind] ?? r.entry_kind,
      origin: r.entry_kind === 'external' ? 'external' : 'internal',
      locationText: r.location_text,
      defectTypeCode: r.defect_type_code,
      defectTypeName: r.defect_type_name,
      outcome: r.outcome,
      caseId: r.case_id,
      caseNo: r.case_no,
      sourceId: r.source_id,
    })),
  };
}

/** 항목 상세 — 사진·AI 결과(고지 포함)·판정·보수 결과 */
export async function historyEntryDetail(buildingId: number, kind: string, sourceId: number) {
  if (kind === 'external') {
    const x = await queryOne('SELECT * FROM external_history WHERE ext_id = ? AND building_id = ?', [sourceId, buildingId]);
    return x
      ? {
          kind,
          external: {
            bmsRecordRef: x.bms_record_ref,
            occurredOn: x.occurred_on,
            locationText: x.location_text,
            defectTypeCode: x.defect_type_code,
            summary: x.summary,
          },
        }
      : null;
  }
  let caseId: number | null = null;
  let recordId: number | null = null;
  if (kind === 'ai_analysis') {
    const r = await queryOne<{ case_id: number }>(
      'SELECT q.case_id FROM analysis_result ar JOIN analysis_request q ON q.request_id = ar.request_id JOIN defect_case c ON c.case_id = q.case_id WHERE ar.result_id = ? AND c.building_id = ?',
      [sourceId, buildingId],
    );
    caseId = r?.case_id ?? null;
  } else if (kind === 'field_record') {
    const r = await queryOne<{ case_id: number }>('SELECT case_id FROM inspection_record WHERE record_id = ? AND building_id = ?', [
      sourceId,
      buildingId,
    ]);
    caseId = r?.case_id ?? null;
    recordId = sourceId;
  } else if (kind === 'expert_verdict') {
    const r = await queryOne<{ case_id: number; record_id: number }>(
      'SELECT r.case_id, r.record_id FROM expert_verdict v JOIN verification_item i ON i.item_id = v.item_id JOIN inspection_record r ON r.record_id = i.record_id WHERE v.verdict_id = ? AND r.building_id = ?',
      [sourceId, buildingId],
    );
    caseId = r?.case_id ?? null;
    recordId = r?.record_id ?? null;
  } else if (kind === 'expert_connection') {
    const r = await queryOne<{ case_id: number }>(
      'SELECT er.case_id FROM expert_connection ec JOIN expert_request_attempt t ON t.attempt_id = ec.attempt_id JOIN expert_request er ON er.exp_req_id = t.exp_req_id WHERE ec.connection_id = ? AND er.building_id = ?',
      [sourceId, buildingId],
    );
    caseId = r?.case_id ?? null;
  }
  if (!caseId) return null;
  const result = await queryOne<{ result_id: number; request_id: number }>(
    'SELECT ar.result_id, ar.request_id FROM analysis_result ar JOIN analysis_request q ON q.request_id = ar.request_id WHERE q.case_id = ? ORDER BY ar.result_id DESC LIMIT 1',
    [caseId],
  );
  const rec = recordId
    ? await queryOne(
        `SELECT r.*, d.defect_type_name FROM inspection_record r LEFT JOIN defect_type_code d ON d.defect_type_code = r.defect_type_code WHERE r.record_id = ?`,
        [recordId],
      )
    : await queryOne(
        `SELECT r.*, d.defect_type_name FROM inspection_record r LEFT JOIN defect_type_code d ON d.defect_type_code = r.defect_type_code
          WHERE r.case_id = ? AND r.record_status = 'saved' ORDER BY r.record_id DESC LIMIT 1`,
        [caseId],
      );
  const verdicts = rec
    ? await query(
        `SELECT v.version_no, v.verdict, v.opinion, v.diff_note, v.risk_high, v.decided_at, v.expert_id
           FROM expert_verdict v JOIN verification_item i ON i.item_id = v.item_id WHERE i.record_id = ? ORDER BY v.version_no DESC`,
        [rec.record_id],
      )
    : [];
  const experts = await maskedUsers(verdicts.map((v) => v.expert_id));
  const c = await queryOne<{ case_no: string }>('SELECT case_no FROM defect_case WHERE case_id = ?', [caseId]);
  return {
    kind,
    caseId,
    caseNo: c?.case_no,
    result: result ? await resultDto(result.result_id) : null,
    analysisPhotos: result
      ? await analysisPhotos(result.request_id, undefined, { defect: rec?.defect_type_name, location: rec?.location_text })
      : [],
    record: rec
      ? {
          recordId: rec.record_id,
          locationText: rec.location_text,
          defectTypeCode: rec.defect_type_code,
          defectTypeName: rec.defect_type_name,
          repairStatus: rec.repair_status,
          repairMethod: rec.repair_method,
          inspectionNote: rec.inspection_note,
          aiMatch: rec.ai_match,
          savedAt: rec.saved_at,
          photos: await recordPhotos(rec.record_id, undefined, { defect: rec.defect_type_name, location: rec.location_text }),
        }
      : null,
    verdicts: verdicts.map((v) => ({
      versionNo: v.version_no,
      verdict: v.verdict,
      opinion: v.opinion,
      diffNote: v.diff_note,
      riskHigh: !!v.risk_high,
      decidedAt: v.decided_at,
      expert: experts.get(v.expert_id) ?? null,
    })),
  };
}

/** FR-053 · G7 — v_pattern_gate 먼저, 통과 시 v_repeat_defect + 근거 */
export async function repeatDefects(buildingId: number) {
  const g = await queryOne<{ history_count: number; min_required: string | null; passed: number }>(
    'SELECT history_count, min_required, passed FROM v_pattern_gate WHERE building_id = ?',
    [buildingId],
  );
  const source = await syncState(buildingId);
  if (!g?.passed) {
    const openG7 = await queryOne(
      "SELECT 1 AS x FROM gate_event WHERE gate_code = 'G7' AND subject_kind = 'building' AND subject_id = ? AND released_at IS NULL",
      [buildingId],
    );
    const block = await buildBlock('G7', {
      record: !openG7,
      subject: { kind: 'building', id: buildingId },
      reason:
        g?.min_required == null
          ? '반복 하자 판단 기준(최소 이력 수)이 아직 설정되지 않았습니다'
          : `저장된 이력 ${g.history_count}건 - 최소 ${g.min_required}건이 필요합니다`,
      actions: [
        {
          id: 'request-records',
          label: '현장 기록 축적 요청 보내기',
          href: `/schedules?buildingId=${buildingId}&item=${encodeURIComponent('현장 점검 기록 축적')}`,
        },
      ],
    });
    return {
      blocked: true,
      gate: block,
      historyCount: Number(g?.history_count ?? 0),
      minRequired: g?.min_required ? Number(g.min_required) : null,
      patterns: [],
      source,
    };
  }
  const pats = await query<{ location_text: string; defect_type_code: string; defect_type_name: string; occurrence_count: number }>(
    `SELECT v.location_text, v.defect_type_code, d.defect_type_name, v.occurrence_count
       FROM v_repeat_defect v JOIN defect_type_code d ON d.defect_type_code = v.defect_type_code
      WHERE v.building_id = ? ORDER BY v.occurrence_count DESC, v.location_text`,
    [buildingId],
  );
  const patterns = [];
  for (const p of pats) {
    const [recs, exts] = await Promise.all([
      query<{ record_id: number; case_id: number; saved_at: string; repair_status: string }>(
        `SELECT record_id, case_id, saved_at, repair_status FROM inspection_record
          WHERE building_id = ? AND record_status = 'saved' AND location_text = ? AND defect_type_code = ? ORDER BY saved_at`,
        [buildingId, p.location_text, p.defect_type_code],
      ),
      query<{ ext_id: number; occurred_on: string; summary: string }>(
        'SELECT ext_id, occurred_on, summary FROM external_history WHERE building_id = ? AND location_text = ? AND defect_type_code = ? ORDER BY occurred_on',
        [buildingId, p.location_text, p.defect_type_code],
      ),
    ]);
    patterns.push({
      locationText: p.location_text,
      defectTypeCode: p.defect_type_code,
      defectTypeName: p.defect_type_name,
      occurrenceCount: Number(p.occurrence_count),
      latestCaseId: recs.length ? recs[recs.length - 1].case_id : null,
      basis: [
        ...recs.map((r) => ({
          kind: 'field_record',
          id: r.record_id,
          caseId: r.case_id,
          occurredAt: r.saved_at,
          summary: `현장 기록 · 보수 ${r.repair_status === 'completed' ? '완료' : '미완료'}`,
        })),
        ...exts.map((x) => ({ kind: 'external', id: x.ext_id, caseId: null, occurredAt: x.occurred_on, summary: x.summary })),
      ].sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt))),
    });
  }
  return { blocked: false, gate: null, historyCount: Number(g.history_count), minRequired: Number(g.min_required), patterns, source };
}
