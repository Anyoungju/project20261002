import { exec } from '../pool';
import { SeedContext, daysFromToday } from './lib/seedContext';

/** tasks 부록 A — 조직·건물·계정·역할·건물 권한·전문가 프로필 */
export async function seedBase(ctx: SeedContext) {
  const hb = await exec('INSERT INTO organization (org_name, license_expires_on) VALUES (?, ?)', ['한빛FM', daysFromToday(365)]);
  const ss = await exec('INSERT INTO organization (org_name, license_expires_on) VALUES (?, ?)', ['새솔관리', daysFromToday(-10)]);
  ctx.orgs.set('ORG-HB', hb.insertId);
  ctx.orgs.set('ORG-SS', ss.insertId);

  const blds: Array<[string, string, string, number, string | null]> = [
    ['BLD-A', '한빛오피스타워 A동', 'office', hb.insertId, 'HB-A'],
    ['BLD-B', '한빛아파트 101동', 'apartment', hb.insertId, 'HB-B'],
    ['BLD-C', '한빛물류센터', 'office', hb.insertId, 'FAIL-HB-C'],
    ['BLD-D', '새솔빌딩', 'apartment', ss.insertId, null],
  ];
  for (const [key, name, type, org, bms] of blds) {
    const r = await exec('INSERT INTO building (org_id, building_name, building_type_code, bms_ref) VALUES (?, ?, ?, ?)', [
      org,
      name,
      type,
      bms,
    ]);
    ctx.buildings.set(key, r.insertId);
  }

  // 이름·전화번호는 시연용 가상값 (v_user_masked 로만 노출)
  await ctx.createUser('general@dev.local', '김민준', '010-2345-6789', null, ['general']);
  await ctx.createUser('general.empty@dev.local', '이서연', '010-3456-7890', null, ['general']);
  await ctx.createUser('general.expired@dev.local', '박도윤', '010-4567-8901', null, ['general']);
  await ctx.createUser('facility@dev.local', '최현우', '010-5678-9012', 'ORG-HB', ['facility']);
  await ctx.createUser('facility.c@dev.local', '정하은', '010-6789-0123', 'ORG-HB', ['facility']);
  await ctx.createUser('building@dev.local', '강지호', '010-7890-1234', 'ORG-HB', ['building']);
  await ctx.createUser('lead@dev.local', '윤서준', '010-8901-2345', 'ORG-HB', ['facility', 'building']);
  await ctx.createUser('enterprise@dev.local', '한지민', '010-9012-3456', 'ORG-HB', ['enterprise']);
  await ctx.createUser('enterprise.ss@dev.local', '오세훈', '010-1122-3344', 'ORG-SS', ['enterprise']);
  await ctx.createUser('expert@dev.local', '임태양', '010-2233-4455', null, ['expert']);
  await ctx.createUser('expert.arch@dev.local', '신유나', '010-3344-5566', null, ['expert']);
  await ctx.createUser('expert.busy@dev.local', '조민재', '010-4455-6677', null, ['expert']);
  await ctx.createUser('operator@dev.local', '운영자', null, null, [], { operator: true });
  await ctx.createUser('disabled@dev.local', '배수아', '010-5566-7788', null, ['general'], { disabled: true });

  const grant = (email: string, bld: string, kind: 'record' | 'manage') =>
    exec('INSERT INTO building_access (user_id, building_id, access_kind) VALUES (?, ?, ?)', [ctx.u(email), ctx.b(bld), kind]);
  await grant('facility@dev.local', 'BLD-A', 'record');
  await grant('facility@dev.local', 'BLD-B', 'record');
  await grant('facility.c@dev.local', 'BLD-C', 'record');
  await grant('building@dev.local', 'BLD-A', 'manage');
  await grant('building@dev.local', 'BLD-B', 'manage');
  await grant('lead@dev.local', 'BLD-C', 'record');
  await grant('lead@dev.local', 'BLD-C', 'manage');

  const spec = (email: string, codes: string[]) =>
    Promise.all(codes.map((c) => exec('INSERT INTO expert_specialty (expert_id, specialty_code) VALUES (?, ?)', [ctx.u(email), c])));
  await spec('expert@dev.local', ['structure', 'waterproof']);
  await spec('expert.arch@dev.local', ['architecture', 'structure']);
  await spec('expert.busy@dev.local', ['waterproof']);
  for (let d = 0; d <= 14; d++)
    await exec('INSERT INTO expert_availability (expert_id, available_on) VALUES (?, ?)', [ctx.u('expert@dev.local'), daysFromToday(d)]);
  for (let d = 0; d <= 7; d++)
    await exec('INSERT INTO expert_availability (expert_id, available_on) VALUES (?, ?)', [
      ctx.u('expert.arch@dev.local'),
      daysFromToday(d),
    ]);
  // expert.busy 는 가능일 없음 → G8 재현
}
