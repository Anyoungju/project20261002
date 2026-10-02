import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { splitSqlStatements } from '../../src/db/sqlSplitter';

describe('splitSqlStatements (R4 DELIMITER 해석)', () => {
  const ddl = fs.readFileSync(path.resolve(__dirname, '../../src/db/migrations/001_buildcare_ddl.sql'), 'utf8');
  const stmts = splitSqlStatements(ddl);

  it('트리거 15개가 각각 한 문장으로 나온다', () => {
    const triggers = stmts.filter((s) => /^CREATE TRIGGER/i.test(s));
    expect(triggers).toHaveLength(15);
    for (const t of triggers) expect(t).toMatch(/END$/);
  });
  it('DELIMITER 지시어는 서버로 보내지 않는다', () => {
    expect(stmts.some((s) => /DELIMITER/i.test(s))).toBe(false);
  });
  it('테이블 40 · 뷰 16', () => {
    expect(stmts.filter((s) => /^CREATE TABLE/i.test(s))).toHaveLength(40);
    expect(stmts.filter((s) => /^CREATE OR REPLACE VIEW/i.test(s))).toHaveLength(16);
  });
  it('문자열·주석 안의 세미콜론은 구분자가 아니다', () => {
    const s = splitSqlStatements('SELECT \'a;b\'; -- x;y\nSELECT "c;d"; /* e;f */ SELECT 1;');
    expect(s).toEqual(["SELECT 'a;b'", 'SELECT "c;d"', 'SELECT 1']);
  });
  it('사용자 지정 구분자', () => {
    const s = splitSqlStatements('DELIMITER //\nCREATE TRIGGER t BEGIN SELECT 1; SELECT 2; END //\nDELIMITER ;\nSELECT 3;');
    expect(s).toEqual(['CREATE TRIGGER t BEGIN SELECT 1; SELECT 2; END', 'SELECT 3']);
  });
});
