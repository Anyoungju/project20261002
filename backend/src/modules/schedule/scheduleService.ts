import { exec, query, queryOne, withTransaction } from '../../db/pool';
import { notify } from '../notification/notificationService';
import { maskedUsers } from '../../lib/mask';
import { HttpError, notFound, conflict } from '../../lib/http';
import { hasBuildingAccess } from '../../middleware/authorize';

export const CYCLES = { month: '월', quarter: '분기', half: '반기', year: '연' } as const;

async function buildingManagers(buildingId: number) {
  return query<{ user_id: number }>(
    `SELECT DISTINCT a.user_id FROM v_access_check a JOIN user_role r ON r.user_id = a.user_id AND r.role_code = 'building'
      WHERE a.building_id = ? AND a.access_kind = 'manage'`,
    [buildingId],
  );
}

/** 담당자 후보: 이 건물 record 권한이 있는 시설관리자 (마스킹) */
export async function assigneeCandidates(buildingId: number) {
  const rows = await query<{ user_id: number }>(
    `SELECT DISTINCT a.user_id FROM v_access_check a JOIN user_role r ON r.user_id = a.user_id AND r.role_code = 'facility'
      WHERE a.building_id = ? AND a.access_kind = 'record'`,
    [buildingId],
  );
  const m = await maskedUsers(rows.map((r) => r.user_id));
  return rows.map((r) => m.get(r.user_id)!).filter(Boolean);
}

/** FR-070 · 표시 상태는 v_schedule_status 만 */
export async function listSchedules(buildingId: number) {
  const rows = await query(
    `SELECT s.schedule_id, s.building_id, s.item_text, s.cycle_code, s.assignee_id, s.due_date, s.schedule_status,
            s.completed_record_id, s.created_at, s.cancelled_at, v.display_status, v.overdue_alert_sent,
            (SELECT COUNT(*) FROM inspection_record_risk k WHERE k.record_id = s.completed_record_id AND k.risk_flag) AS risk_flag,
            (SELECT r.case_id FROM inspection_record r WHERE r.record_id = s.completed_record_id) AS completed_case_id,
            (SELECT n.risk_notice_id FROM risk_notice n WHERE n.schedule_id = s.schedule_id AND n.closed_at IS NULL LIMIT 1) AS open_risk_notice_id
       FROM inspection_schedule s JOIN v_schedule_status v ON v.schedule_id = s.schedule_id
      WHERE s.building_id = ?
      ORDER BY FIELD(v.display_status, 'overdue', 'due', 'scheduled', 'completed', 'cancelled'), s.due_date`,
    [buildingId],
  );
  const people = await maskedUsers(rows.map((r) => r.assignee_id));
  return rows.map((r) => ({
    scheduleId: r.schedule_id,
    buildingId: r.building_id,
    itemText: r.item_text,
    cycleCode: r.cycle_code,
    cycleName: r.cycle_code ? ((CYCLES as any)[r.cycle_code] ?? r.cycle_code) : null,
    assignee: people.get(r.assignee_id) ?? null,
    dueDate: r.due_date,
    storedStatus: r.schedule_status,
    displayStatus: r.display_status,
    overdueAlertSent: !!r.overdue_alert_sent,
    completedRecordId: r.completed_record_id,
    completedCaseId: r.completed_case_id,
    riskFlag: !!Number(r.risk_flag),
    openRiskNoticeId: r.open_risk_notice_id,
    createdAt: r.created_at,
    cancelledAt: r.cancelled_at,
  }));
}

export async function createSchedule(
  creatorId: number,
  buildingId: number,
  s: { itemText: string; cycleCode?: string | null; assigneeId: number; dueDate: string },
) {
  const okAssignee =
    (await hasBuildingAccess(s.assigneeId, buildingId, 'record')) &&
    !!(await queryOne("SELECT 1 AS x FROM user_role WHERE user_id = ? AND role_code = 'facility'", [s.assigneeId]));
  if (!okAssignee) throw new HttpError(422, 'invalid_assignee', '이 건물에 기록 권한이 있는 시설관리자만 배정할 수 있습니다');
  const b = await queryOne<{ building_name: string }>('SELECT building_name FROM building WHERE building_id = ?', [buildingId]);
  const id = await withTransaction(async (conn) => {
    const r = await exec(
      'INSERT INTO inspection_schedule (building_id, item_text, cycle_code, assignee_id, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [buildingId, s.itemText.trim(), s.cycleCode ?? null, s.assigneeId, s.dueDate, creatorId],
      conn,
    );
    // FR-071 · FR-077 — 배정 통지 + 발송 사실
    await exec(
      "INSERT INTO schedule_alert (schedule_id, alert_kind, recipient_id) VALUES (?, 'assigned', ?)",
      [r.insertId, s.assigneeId],
      conn,
    );
    return r.insertId;
  });
  await notify(
    s.assigneeId,
    'schedule_assigned',
    { kind: 'inspection_schedule', id },
    `정기점검 배정: ${b?.building_name} · ${s.itemText} (기한 ${s.dueDate})`,
    '/me/assignments',
  );
  return id;
}

async function loadSchedule(id: number) {
  return queryOne<{
    schedule_id: number;
    building_id: number;
    assignee_id: number;
    schedule_status: string;
    item_text: string;
    due_date: string;
  }>('SELECT schedule_id, building_id, assignee_id, schedule_status, item_text, due_date FROM inspection_schedule WHERE schedule_id = ?', [
    id,
  ]);
}

export async function scheduleBuildingId(id: number) {
  return (await loadSchedule(id))?.building_id ?? null;
}

export async function updateSchedule(
  id: number,
  s: { itemText?: string; cycleCode?: string | null; assigneeId?: number; dueDate?: string },
) {
  const cur = await loadSchedule(id);
  if (!cur) throw notFound('일정을 찾을 수 없습니다');
  if (cur.schedule_status !== 'scheduled') throw conflict('완료·취소된 일정은 수정할 수 없습니다', 'schedule_closed');
  if (s.assigneeId && s.assigneeId !== cur.assignee_id) {
    const ok =
      (await hasBuildingAccess(s.assigneeId, cur.building_id, 'record')) &&
      !!(await queryOne("SELECT 1 AS x FROM user_role WHERE user_id = ? AND role_code = 'facility'", [s.assigneeId]));
    if (!ok) throw new HttpError(422, 'invalid_assignee', '이 건물에 기록 권한이 있는 시설관리자만 배정할 수 있습니다');
  }
  await exec(
    `UPDATE inspection_schedule SET item_text = COALESCE(?, item_text), cycle_code = IF(?, ?, cycle_code),
            assignee_id = COALESCE(?, assignee_id), due_date = COALESCE(?, due_date) WHERE schedule_id = ?`,
    [s.itemText?.trim() ?? null, s.cycleCode !== undefined, s.cycleCode ?? null, s.assigneeId ?? null, s.dueDate ?? null, id],
  );
  if (s.assigneeId && s.assigneeId !== cur.assignee_id) {
    await exec("INSERT INTO schedule_alert (schedule_id, alert_kind, recipient_id) VALUES (?, 'assigned', ?)", [id, s.assigneeId]);
    await notify(
      s.assigneeId,
      'schedule_assigned',
      { kind: 'inspection_schedule', id },
      `정기점검 배정: ${s.itemText ?? cur.item_text}`,
      '/me/assignments',
    );
  }
}

/** FR-074 — 취소 즉시 감시 제외(뷰가 cancelled 로 뺀다) */
export async function cancelSchedule(id: number) {
  const cur = await loadSchedule(id);
  if (!cur) throw notFound('일정을 찾을 수 없습니다');
  if (cur.schedule_status !== 'scheduled') throw conflict('예정 상태의 일정만 취소할 수 있습니다', 'schedule_closed');
  await exec("UPDATE inspection_schedule SET schedule_status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE schedule_id = ?", [id]);
}

/** FR-073 · FR-076 — 같은 건물의 저장 기록 연결로만 완료(trg_schedule_bu). 위험 표시 기록이면 위험 통지 */
export async function completeScheduleWithRecord(scheduleId: number, recordId: number, actorId: number) {
  const cur = await loadSchedule(scheduleId);
  if (!cur) throw notFound('일정을 찾을 수 없습니다');
  if (cur.schedule_status === 'completed') return { scheduleId };
  if (cur.schedule_status !== 'scheduled') throw conflict('취소된 일정은 완료할 수 없습니다', 'schedule_closed');
  const canManage = await hasBuildingAccess(actorId, cur.building_id, 'manage');
  if (cur.assignee_id !== actorId && !canManage) throw new HttpError(403, 'not_assignee', '담당자 또는 건물관리자만 완료할 수 있습니다');
  const rec = await queryOne<{ case_id: number; risk: number | null }>(
    'SELECT r.case_id, k.risk_flag AS risk FROM inspection_record r LEFT JOIN inspection_record_risk k ON k.record_id = r.record_id WHERE r.record_id = ?',
    [recordId],
  );
  if (!rec) throw notFound('기록을 찾을 수 없습니다');
  await withTransaction(async (conn) => {
    await exec(
      "UPDATE inspection_schedule SET schedule_status = 'completed', completed_record_id = ? WHERE schedule_id = ?",
      [recordId, scheduleId],
      conn,
    );
    if (rec.risk) {
      await exec(
        "INSERT INTO risk_notice (case_id, source_kind, schedule_id) VALUES (?, 'inspection', ?)",
        [rec.case_id, scheduleId],
        conn,
      );
    }
  });
  if (rec.risk) {
    for (const m of await buildingManagers(cur.building_id)) {
      await notify(
        m.user_id,
        'risk_notice',
        { kind: 'inspection_schedule', id: scheduleId },
        `위험 통지: 정기점검 결과 위험 - ${cur.item_text}`,
        `/expert-requests/new?caseId=${rec.case_id}`,
      );
    }
  }
  return { scheduleId };
}

/** S7B — 배정·도래·지연 + 추가 자료 요청(v_data_request_inbox) */
export async function myAssignments(userId: number) {
  const rows = await query(
    `SELECT v.schedule_id, v.building_id, b.building_name, v.item_text, v.due_date, v.display_status, s.cycle_code
       FROM v_schedule_status v JOIN inspection_schedule s ON s.schedule_id = v.schedule_id JOIN building b ON b.building_id = v.building_id
      WHERE v.assignee_id = ? AND v.display_status IN ('scheduled', 'due', 'overdue')
      ORDER BY FIELD(v.display_status, 'overdue', 'due', 'scheduled'), v.due_date`,
    [userId],
  );
  const dataReqs = await query(
    `SELECT x.data_req_id, x.case_no, x.reason, x.sent_at, i.record_id, r.building_id, b.building_name
       FROM v_data_request_inbox x JOIN data_request d ON d.data_req_id = x.data_req_id
       JOIN verification_item i ON i.item_id = d.item_id JOIN inspection_record r ON r.record_id = i.record_id
       JOIN building b ON b.building_id = r.building_id
      WHERE x.recipient_id = ? ORDER BY x.sent_at`,
    [userId],
  );
  const schedules = rows.map((r) => ({
    scheduleId: r.schedule_id,
    buildingId: r.building_id,
    buildingName: r.building_name,
    itemText: r.item_text,
    dueDate: r.due_date,
    displayStatus: r.display_status,
    cycleName: r.cycle_code ? ((CYCLES as any)[r.cycle_code] ?? r.cycle_code) : null,
  }));
  return {
    rail: {
      assigned: schedules.length,
      due: schedules.filter((s) => s.displayStatus === 'due').length,
      overdue: schedules.filter((s) => s.displayStatus === 'overdue').length,
      dataRequests: dataReqs.length,
    },
    schedules,
    dataRequests: dataReqs.map((d) => ({
      dataReqId: d.data_req_id,
      caseNo: d.case_no,
      reason: d.reason,
      sentAt: d.sent_at,
      recordId: d.record_id,
      buildingId: d.building_id,
      buildingName: d.building_name,
    })),
  };
}

/** P0 — 도래·지연 감시 (R13 · FR-072 · SC-013) */
export async function runP0Watch() {
  const due = await query<{ schedule_id: number; assignee_id: number; item_text: string; due_date: string; building_name: string }>(
    `SELECT v.schedule_id, v.assignee_id, v.item_text, v.due_date, b.building_name FROM v_schedule_status v JOIN building b ON b.building_id = v.building_id
      WHERE v.display_status = 'due'
        AND NOT EXISTS (SELECT 1 FROM schedule_alert a WHERE a.schedule_id = v.schedule_id AND a.alert_kind = 'due')`,
  );
  for (const s of due) {
    await exec("INSERT INTO schedule_alert (schedule_id, alert_kind, recipient_id) VALUES (?, 'due', ?)", [s.schedule_id, s.assignee_id]);
    await notify(
      s.assignee_id,
      'schedule_due',
      { kind: 'inspection_schedule', id: s.schedule_id },
      `점검 기한 도래: ${s.building_name} · ${s.item_text} (기한 ${s.due_date})`,
      '/me/assignments',
    );
  }
  const overdue = await query<{
    schedule_id: number;
    building_id: number;
    assignee_id: number;
    item_text: string;
    due_date: string;
    building_name: string;
  }>(
    `SELECT v.schedule_id, v.building_id, v.assignee_id, v.item_text, v.due_date, b.building_name FROM v_schedule_status v JOIN building b ON b.building_id = v.building_id
      WHERE v.display_status = 'overdue' AND v.overdue_alert_sent = 0`,
  );
  for (const s of overdue) {
    // 담당자 지연 알림 + 건물관리자 화면 표시(알림) — 둘 다 (FR-072)
    await exec("INSERT INTO schedule_alert (schedule_id, alert_kind, recipient_id) VALUES (?, 'overdue', ?)", [
      s.schedule_id,
      s.assignee_id,
    ]);
    await notify(
      s.assignee_id,
      'schedule_overdue',
      { kind: 'inspection_schedule', id: s.schedule_id },
      `점검 지연: ${s.building_name} · ${s.item_text} (기한 ${s.due_date} 경과)`,
      '/me/assignments',
    );
    for (const m of await buildingManagers(s.building_id)) {
      await notify(
        m.user_id,
        'schedule_overdue',
        { kind: 'inspection_schedule', id: s.schedule_id },
        `점검 지연: ${s.building_name} · ${s.item_text}`,
        `/buildings/${s.building_id}/schedules`,
      );
    }
  }
  console.log(`[job:p0] due ${due.length} · overdue ${overdue.length}`);
  return { due: due.length, overdue: overdue.length };
}
