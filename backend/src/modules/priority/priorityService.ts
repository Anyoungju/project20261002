import { exec, query, queryOne, withTransaction } from '../../db/pool';
import { gateError } from '../../gates/gateBlock';
import { currentNotice, noticeById } from '../reference/referenceRouter';
import { DEFAULT_WEIGHTS, GroupInput, monthsBetween, rankGroups, Weights } from './priorityCalculator';
import { syncState } from '../building/buildingService';
import { trustMetrics } from '../verification/verificationService';
import { HttpError, notFound } from '../../lib/http';
import { notify } from '../notification/notificationService';

async function constNum(key: string): Promise<number | null> {
  const r = await queryOne<{ const_value: string | null }>('SELECT const_value FROM service_constant WHERE const_key = ?', [key]);
  if (r?.const_value == null) return null;
  const n = Number(r.const_value);
  return Number.isFinite(n) ? n : null;
}

async function weights(): Promise<Weights> {
  return {
    repeat: (await constNum('priority_w_repeat')) ?? DEFAULT_WEIGHTS.repeat,
    risk: (await constNum('priority_w_risk')) ?? DEFAULT_WEIGHTS.risk,
    age: (await constNum('priority_w_age')) ?? DEFAULT_WEIGHTS.age,
    openNotice: (await constNum('priority_w_open_notice')) ?? DEFAULT_WEIGHTS.openNotice,
  };
}

/** 스펙 Assumptions — 라이선스 만료일 경과 시 G0 방식 차단 (NULL = 만료일 미정 → 허용) */
export async function assertLicense(orgId: number, actorId: number) {
  const o = await queryOne<{ org_name: string; license_expires_on: string | null; expired: number }>(
    'SELECT org_name, license_expires_on, (license_expires_on IS NOT NULL AND license_expires_on < CURRENT_DATE) AS expired FROM organization WHERE org_id = ?',
    [orgId],
  );
  if (!o) throw notFound('조직을 찾을 수 없습니다');
  if (o.expired) {
    throw await gateError('G0', {
      status: 403,
      reason: `기업 라이선스가 만료되었습니다(${o.license_expires_on}) - 라이선스 갱신 후 이용할 수 있습니다`,
      actorId,
      subject: { kind: 'organization', id: orgId },
      actions: [{ id: 'permission-request', label: '권한 요청 보내기' }],
    });
  }
  return o;
}

export async function dashboard(orgId: number, actorId: number) {
  const o = await assertLicense(orgId, actorId);
  const buildings = await query(
    `SELECT b.building_id, b.building_name, t.building_type_name, r.history_count, r.overdue_count, r.awaiting_count,
            (SELECT COUNT(*) FROM risk_notice n JOIN defect_case c ON c.case_id = n.case_id WHERE c.building_id = b.building_id AND n.closed_at IS NULL) AS open_notices,
            (SELECT COUNT(*) FROM inspection_record x WHERE x.building_id = b.building_id AND x.record_status = 'saved' AND x.repair_status = 'pending') AS pending_repairs,
            (SELECT MIN(s.due_date) FROM v_schedule_status s WHERE s.building_id = b.building_id AND s.display_status IN ('scheduled','due','overdue')) AS next_due
       FROM building b JOIN building_type_code t ON t.building_type_code = b.building_type_code
       JOIN v_building_rail r ON r.building_id = b.building_id
      WHERE b.org_id = ? ORDER BY b.building_name`,
    [orgId],
  );
  const analyses = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM analysis_result ar JOIN analysis_request q ON q.request_id = ar.request_id
       JOIN defect_case c ON c.case_id = q.case_id JOIN building b ON b.building_id = c.building_id WHERE b.org_id = ?`,
    [orgId],
  );
  const runs = await query(
    'SELECT run_id, period_from, period_to, external_included, excluded_building_count, created_at FROM priority_run WHERE org_id = ? ORDER BY run_id DESC LIMIT 10',
    [orgId],
  );
  const nextDue =
    buildings
      .map((b) => b.next_due)
      .filter(Boolean)
      .sort()[0] ?? null;
  const trust = await trustMetrics();
  const out = [];
  for (const b of buildings) {
    out.push({
      buildingId: b.building_id,
      buildingName: b.building_name,
      buildingTypeName: b.building_type_name,
      historyCount: Number(b.history_count),
      overdueCount: Number(b.overdue_count),
      awaitingCount: Number(b.awaiting_count),
      openNotices: Number(b.open_notices),
      pendingRepairs: Number(b.pending_repairs),
      nextDue: b.next_due,
      source: await syncState(b.building_id),
    });
  }
  return {
    org: { orgId, orgName: o.org_name, licenseExpiresOn: o.license_expires_on },
    summary: {
      analysisCount: Number(analyses?.n ?? 0),
      actionNeeded: out.reduce((s, b) => s + b.openNotices + b.pendingRepairs, 0),
      nextDue,
      daysToNextDue: nextDue
        ? Math.ceil(
            (new Date(nextDue).getTime() - new Date(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)).getTime()) / 86400_000,
          )
        : null,
      expertMatchRate: trust.overall.matchRate,
    },
    buildings: out,
    runs: runs.map((r) => ({
      runId: r.run_id,
      periodFrom: r.period_from,
      periodTo: r.period_to,
      externalIncluded: !!r.external_included,
      excludedBuildingCount: r.excluded_building_count,
      createdAt: r.created_at,
    })),
  };
}

const RISK_SCORE: Record<string, 0 | 1 | 2> = { normal: 0, caution: 1, danger: 2 };

/** FR-061 ~ FR-065 — 스냅숏 산출 */
export async function createRun(orgId: number, userId: number, buildingIds: number[], from: string, to: string) {
  await assertLicense(orgId, userId);
  if (from > to) throw new HttpError(422, 'period', '기간 시작일이 종료일보다 늦습니다');
  const uniq = [...new Set(buildingIds)];
  const allowed = uniq.length
    ? (
        await query<{ building_id: number }>('SELECT DISTINCT building_id FROM v_access_check WHERE user_id = ? AND building_id IN (?)', [
          userId,
          uniq,
        ])
      ).map((r) => r.building_id)
    : [];
  const excluded = uniq.length - allowed.length;
  let externalIncluded = true;
  for (const b of allowed) {
    const s = await syncState(b);
    if (s.connected && s.lastSyncStatus !== 'ok') externalIncluded = false;
  }

  const groups = new Map<string, GroupInput & { firstPending: string | null }>();
  const key = (b: number, l: string | null, d: string) => `${b}|${l ?? ''}|${d}`;
  if (allowed.length) {
    const recs = await query<{
      record_id: number;
      building_id: number;
      location_text: string | null;
      defect_type_code: string;
      repair_status: string;
      saved_at: string;
      case_id: number;
      risk_level: string | null;
      risk_high: number;
      risk_flag: number | null;
      open_notices: number;
    }>(
      `SELECT r.record_id, r.building_id, r.location_text, r.defect_type_code, r.repair_status, r.saved_at, r.case_id,
              (SELECT ar.risk_level FROM analysis_result ar WHERE ar.result_id = r.result_id) AS risk_level,
              (SELECT MAX(v.risk_high) FROM expert_verdict v JOIN verification_item i ON i.item_id = v.item_id WHERE i.record_id = r.record_id) AS risk_high,
              (SELECT k.risk_flag FROM inspection_record_risk k WHERE k.record_id = r.record_id) AS risk_flag,
              (SELECT COUNT(*) FROM risk_notice n WHERE n.case_id = r.case_id AND n.closed_at IS NULL) AS open_notices
         FROM inspection_record r
        WHERE r.record_status = 'saved' AND r.building_id IN (?) AND DATE(r.saved_at) BETWEEN ? AND ?`,
      [allowed, from, to],
    );
    for (const r of recs) {
      const k = key(r.building_id, r.location_text, r.defect_type_code);
      const g =
        groups.get(k) ??
        ({
          buildingId: r.building_id,
          locationText: r.location_text,
          defectTypeCode: r.defect_type_code,
          entryCount: 0,
          maxRisk: 0,
          unresolvedMonths: 0,
          openNotices: 0,
          basis: [],
          firstPending: null,
        } as any);
      g.entryCount++;
      const risk = Math.max(RISK_SCORE[r.risk_level ?? 'normal'] ?? 0, r.risk_high || r.risk_flag ? 2 : 0) as 0 | 1 | 2;
      g.maxRisk = Math.max(g.maxRisk, risk) as 0 | 1 | 2;
      g.openNotices += Number(r.open_notices);
      if (r.repair_status === 'pending' && (!g.firstPending || r.saved_at < g.firstPending)) g.firstPending = r.saved_at;
      g.basis.push({ recordId: r.record_id });
      groups.set(k, g);
    }
    {
      // 외부 이력은 적재된 것만 쓴다(연동 실패 건물은 최신이 아닐 수 있어 external_included=false 로 표시)
      const exts = await query<{ ext_id: number; building_id: number; location_text: string | null; defect_type_code: string | null }>(
        'SELECT ext_id, building_id, location_text, defect_type_code FROM external_history WHERE building_id IN (?) AND occurred_on BETWEEN ? AND ? AND defect_type_code IS NOT NULL',
        [allowed, from, to],
      );
      for (const x of exts) {
        const k = key(x.building_id, x.location_text, x.defect_type_code!);
        const g =
          groups.get(k) ??
          ({
            buildingId: x.building_id,
            locationText: x.location_text,
            defectTypeCode: x.defect_type_code,
            entryCount: 0,
            maxRisk: 0,
            unresolvedMonths: 0,
            openNotices: 0,
            basis: [],
            firstPending: null,
          } as any);
        g.entryCount++;
        g.basis.push({ extId: x.ext_id });
        groups.set(k, g);
      }
    }
  }
  for (const g of groups.values()) g.unresolvedMonths = g.firstPending ? monthsBetween(g.firstPending) : 0;
  // 기록 데이터가 아예 없는 범위면 openNotices 중복 계산 보정: 같은 건이 여러 기록이면 한 번만
  const minRecords = await constNum('pattern_min_records');
  const ranked = rankGroups([...groups.values()], minRecords, await weights());

  const runId = await withTransaction(async (conn) => {
    const notice = await currentNotice('priority', conn);
    const run = await exec(
      "INSERT INTO priority_run (org_id, requested_by, period_from, period_to, notice_id, notice_kind, external_included, excluded_building_count) VALUES (?, ?, ?, ?, ?, 'priority', ?, ?)",
      [orgId, userId, from, to, notice.noticeId, externalIncluded, excluded],
      conn,
    );
    for (const it of ranked.slice(0, 50)) {
      await exec(
        'INSERT INTO priority_item (run_id, priority_rank, building_id, location_text, defect_type_code, confidence_level) VALUES (?, ?, ?, ?, ?, ?)',
        [run.insertId, it.rank, it.buildingId, it.locationText, it.defectTypeCode, it.confidence],
        conn,
      );
      for (const b of it.basis) {
        await exec(
          'INSERT INTO priority_item_basis (run_id, priority_rank, record_id, ext_id) VALUES (?, ?, ?, ?)',
          [run.insertId, it.rank, b.recordId ?? null, b.extId ?? null],
          conn,
        );
      }
    }
    // FR-064 — 모든 항목 근거 ≥ 1 확인 후 커밋
    const bad = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM priority_item i WHERE i.run_id = ?
         AND NOT EXISTS (SELECT 1 FROM priority_item_basis b WHERE b.run_id = i.run_id AND b.priority_rank = i.priority_rank)`,
      [run.insertId],
      conn,
    );
    if (Number(bad?.n)) throw new Error('FR-064: 근거 없는 우선순위 항목');
    return run.insertId;
  });
  return runId;
}

/** FR-065 — 스냅숏 그대로(재계산 없음) */
export async function runDetail(runId: number) {
  const r = await queryOne('SELECT * FROM priority_run WHERE run_id = ?', [runId]);
  if (!r) return null;
  const notice = await noticeById(r.notice_id);
  if (!notice) throw new Error('BR-DEF-01: 고지 없는 우선순위');
  const items = await query(
    `SELECT i.priority_rank, i.building_id, b.building_name, i.location_text, i.defect_type_code, d.defect_type_name, i.confidence_level, i.assigned_action
       FROM priority_item i JOIN building b ON b.building_id = i.building_id JOIN defect_type_code d ON d.defect_type_code = i.defect_type_code
      WHERE i.run_id = ? ORDER BY i.priority_rank`,
    [runId],
  );
  const basis = await query(
    `SELECT pb.priority_rank, pb.record_id, pb.ext_id, r.saved_at, r.repair_status, r.case_id, c.case_no, x.occurred_on, x.summary
       FROM priority_item_basis pb
       LEFT JOIN inspection_record r ON r.record_id = pb.record_id LEFT JOIN defect_case c ON c.case_id = r.case_id
       LEFT JOIN external_history x ON x.ext_id = pb.ext_id
      WHERE pb.run_id = ? ORDER BY pb.priority_rank, pb.basis_id`,
    [runId],
  );
  return {
    runId: r.run_id,
    orgId: r.org_id,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    externalIncluded: !!r.external_included,
    excludedBuildingCount: r.excluded_building_count,
    createdAt: r.created_at,
    notice,
    items: items.map((i) => {
      const bs = basis.filter((b) => b.priority_rank === i.priority_rank);
      const latestCase = bs.filter((b) => b.case_id).sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)))[0];
      return {
        rank: i.priority_rank,
        buildingId: i.building_id,
        buildingName: i.building_name,
        locationText: i.location_text,
        defectTypeCode: i.defect_type_code,
        defectTypeName: i.defect_type_name,
        confidence: i.confidence_level,
        assignedAction: i.assigned_action,
        latestCaseId: latestCase?.case_id ?? null,
        basis: bs.map((b) =>
          b.record_id
            ? {
                kind: 'field_record',
                id: b.record_id,
                caseId: b.case_id,
                caseNo: b.case_no,
                occurredAt: b.saved_at,
                summary: `현장 기록 · 보수 ${b.repair_status === 'completed' ? '완료' : '미완료'}`,
              }
            : { kind: 'external', id: b.ext_id, caseId: null, caseNo: null, occurredAt: b.occurred_on, summary: b.summary },
        ),
      };
    }),
  };
}

/** FR-066 — UPDATE 는 assigned_action 만 */
export async function assignAction(runId: number, rank: number, action: 'inspection' | 'expert' | null) {
  const r = await exec('UPDATE priority_item SET assigned_action = ? WHERE run_id = ? AND priority_rank = ?', [action, runId, rank]);
  if (!r.affectedRows) throw notFound('우선순위 항목을 찾을 수 없습니다');
  if (!action) return;
  // FR-066 — 조치 대상 화면(S7A·S8A)의 주체인 건물관리자에게 인계
  const it = await queryOne<{
    building_id: number;
    building_name: string;
    location_text: string | null;
    defect_type_code: string;
    defect_type_name: string;
  }>(
    `SELECT i.building_id, b.building_name, i.location_text, i.defect_type_code, d.defect_type_name FROM priority_item i
       JOIN building b ON b.building_id = i.building_id JOIN defect_type_code d ON d.defect_type_code = i.defect_type_code
      WHERE i.run_id = ? AND i.priority_rank = ?`,
    [runId, rank],
  );
  if (!it) return;
  const managers = await query<{ user_id: number }>(
    `SELECT DISTINCT a.user_id FROM v_access_check a JOIN user_role r ON r.user_id = a.user_id AND r.role_code = 'building'
      WHERE a.building_id = ? AND a.access_kind = 'manage'`,
    [it.building_id],
  );
  const label = `${it.building_name} · ${it.location_text ?? ''} ${it.defect_type_name}`.trim();
  const link =
    action === 'inspection'
      ? `/schedules?buildingId=${it.building_id}&item=${encodeURIComponent(`${it.location_text ?? ''} ${it.defect_type_name} 반복 점검`.trim())}&location=${encodeURIComponent(it.location_text ?? '')}&defectType=${it.defect_type_code}`
      : `/buildings/history?buildingId=${it.building_id}&tab=repeat`;
  for (const m of managers) {
    await notify(
      m.user_id,
      'priority_action',
      { kind: 'priority_run', id: runId },
      `우선순위 조치 지정: ${label} - ${action === 'inspection' ? '정기점검 계획' : '전문가 연결'}`,
      link,
    );
  }
}

export async function runOrgId(runId: number) {
  return (await queryOne<{ org_id: number }>('SELECT org_id FROM priority_run WHERE run_id = ?', [runId]))?.org_id ?? null;
}
