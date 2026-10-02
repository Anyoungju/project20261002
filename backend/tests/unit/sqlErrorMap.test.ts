import { describe, it, expect } from 'vitest';
import { mapSqlError } from '../../src/gates/sqlErrorMap';

const signal = (m: string) => ({ sqlState: '45000', errno: 1644, sqlMessage: m });

describe('mapSqlError (트리거 SIGNAL → 게이트 사상 단일 지점)', () => {
  it.each([
    ['G1: approved payment of the same user required', 'G1', 402],
    ['G2: usable entitlement required', 'G2', 402],
    ['G3/G4: result only for request in analyzing state', 'G4', 502],
    ['G6: open data request blocks verdict', 'G6', 409],
    ['G10: connection only for accepted attempt', 'G10', 409],
    ['UC3 E4: field photo required before save', 'G5', 422],
  ])('%s → %s', (msg, gate, status) => {
    const m = mapSqlError(signal(msg))!;
    expect(m.gate).toBe(gate);
    expect(m.status).toBe(status);
  });
  it('BR-DEF-03 · P7 은 게이트 없는 422', () => {
    expect(mapSqlError(signal('BR-DEF-03: photo required before analysis'))).toMatchObject({ status: 422, gate: undefined });
    expect(mapSqlError(signal('P7: completion needs saved record of same building'))).toMatchObject({
      status: 422,
      code: 'schedule_completion_invalid',
    });
  });
  it('저장 기록 되돌림은 409', () => {
    expect(mapSqlError(signal('UC3: saved record cannot return to draft'))?.status).toBe(409);
  });
  it('CHECK 위반 4025 → 422, chk_rec_required_on_save → G5', () => {
    expect(mapSqlError({ errno: 4025, sqlMessage: 'CONSTRAINT `chk_pay_status` failed for `x`.`payment`' })).toMatchObject({
      status: 422,
      code: 'chk_pay_status',
    });
    expect(mapSqlError({ errno: 4025, sqlMessage: 'CONSTRAINT `chk_rec_required_on_save` failed' })?.gate).toBe('G5');
  });
  it('중복 1062 → 409, 그 외 null', () => {
    expect(mapSqlError({ errno: 1062, sqlMessage: 'Duplicate' })?.status).toBe(409);
    expect(mapSqlError(new Error('x'))).toBeNull();
  });
});
