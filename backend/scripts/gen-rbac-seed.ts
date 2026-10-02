/** permissions.ts → 003_rbac_seed.sql 생성 (카탈로그 단일 원천). 적용 후에는 재생성하지 말 것(체크섬 고정). */
import fs from 'node:fs';
import path from 'node:path';
import { PERMISSIONS, DEFAULT_MATRIX, LOCKED_PERMISSIONS } from '../src/auth/permissions';
const esc = (s: string) => s.replace(/'/g, "''");
const lines: string[] = [
  '-- 003_rbac_seed.sql — RBAC 권한 카탈로그 + 기본 매트릭스 (research R22). scripts/gen-rbac-seed.ts 로 생성',
  '-- 멱등: 없을 때만 넣는다. 운영 중 변경은 관리 화면(rbac_role_permission)에서.',
];
for (const [code, desc] of Object.entries(PERMISSIONS)) {
  const locked = LOCKED_PERMISSIONS.includes(code as any) ? 'TRUE' : 'FALSE';
  lines.push(
    `INSERT INTO rbac_permission (permission_code, description, locked) SELECT '${code}', '${esc(desc)}', ${locked} FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM rbac_permission WHERE permission_code = '${code}');`,
  );
}
for (const [role, perms] of Object.entries(DEFAULT_MATRIX)) {
  for (const p of new Set(perms)) {
    lines.push(
      `INSERT INTO rbac_role_permission (role_code, permission_code) SELECT '${role}', '${p}' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM rbac_role_permission WHERE role_code = '${role}' AND permission_code = '${p}');`,
    );
  }
}
fs.writeFileSync(path.resolve(__dirname, '../src/db/migrations/003_rbac_seed.sql'), lines.join('\n') + '\n');
console.log(`003_rbac_seed.sql: ${lines.length - 2} statements`);
