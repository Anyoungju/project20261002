<script setup lang="ts">
/**
 * 관리 · 감사 로그 — 계정·역할·권한·기준값 변경 기록(최근 200건).
 * gate_event.read 가 있으면 게이트 이벤트(차단·해제 기록) 탭도 보인다.
 * 데스크톱은 표, 모바일은 카드.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { get } from '@/api/client';
import { useSession } from '@/stores/session';
import { fmtDate } from '@/composables/useCan';
import CategoryTabs from '@/components/base/CategoryTabs.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import ActionError from '@/components/admin/ActionError.vue';
import { ACCESS_LABEL, AUDIT_ACTION_LABEL, roleLabel } from '@/components/admin/adminLabels';

const session = useSession();
const canGate = computed(() => session.can('gate_event.read'));
const tab = ref('audit');
const tabs = computed(() => [
  { value: 'audit', label: '감사 로그' },
  ...(canGate.value ? [{ value: 'gates', label: '게이트 이벤트' }] : []),
]);

const audit = ref<any[] | null>(null);
const gatesEv = ref<any[] | null>(null);
const loading = ref(false);
const err = ref<unknown>(null);

async function load() {
  loading.value = true;
  err.value = null;
  try {
    if (tab.value === 'audit') audit.value = await get('/api/admin/audit-log');
    else gatesEv.value = await get('/api/admin/gate-events');
  } catch (e) {
    err.value = e;
  } finally {
    loading.value = false;
  }
}
watch(tab, () => {
  if ((tab.value === 'audit' && !audit.value) || (tab.value === 'gates' && !gatesEv.value)) load();
  else err.value = null;
});

/** detail_json → 한 줄 요약 (개인정보 없음: id·코드만 기록된다) */
function detailText(a: any): string {
  const d = a.detail ?? {};
  const parts: string[] = [];
  if (Array.isArray(d.roles)) parts.push(`역할: ${d.roles.length ? d.roles.map(roleLabel).join(', ') : '없음'}`);
  if (d.role) parts.push(`역할: ${roleLabel(d.role)}`);
  if (Array.isArray(d.permissions)) parts.push(`권한 ${d.permissions.length}개`);
  if (d.buildingId != null) parts.push(`건물 #${d.buildingId}`);
  if (d.kind && ACCESS_LABEL[d.kind]) parts.push(ACCESS_LABEL[d.kind]);
  else if (d.kind) parts.push(String(d.kind));
  if (d.permReqId != null) parts.push(`요청 #${d.permReqId}`);
  if (d.key) parts.push(`${d.key} = ${d.value ?? '미설정'}`);
  if (d.planCode) parts.push(`${d.planCode} = ${d.price ?? '미설정'}`);
  if (d.noticeId != null) parts.push(`판본 #${d.noticeId}`);
  if (d.orgId != null && a.action === 'user.create') parts.push(`조직 #${d.orgId}`);
  return parts.join(' · ') || '-';
}

const SUBJECT_LABEL: Record<string, string> = {
  user_account: '계정',
  analysis_request: '분석 요청',
  payment: '결제',
  building: '건물',
  verification_item: '검증 항목',
  expert_request_attempt: '전문가 요청',
  field_record: '현장 기록',
  schedule: '점검 일정',
};

onMounted(load);
</script>

<template>
  <div class="stack-lg">
    <CategoryTabs v-model="tab" :tabs="tabs" label="기록 종류" />

    <ActionError v-if="err" :error="err" :busy="loading" @retry="load" />

    <!-- 감사 로그 -->
    <section v-else-if="tab === 'audit'" aria-labelledby="ad-a">
      <h2 id="ad-a" class="title-lg">감사 로그</h2>
      <p class="caption">최근 200건 · 사용자는 마스킹되어 보입니다</p>
      <div v-if="!audit" class="skeleton" style="height: 200px"></div>
      <p v-else-if="!audit.length" class="empty">기록이 없습니다</p>
      <template v-else>
        <div class="table-wrap desk">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">시각</th>
                <th scope="col">작업</th>
                <th scope="col">한 사람</th>
                <th scope="col">대상</th>
                <th scope="col">내용</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in audit" :key="a.auditId">
                <td class="nowrap">{{ fmtDate(a.at, true) }}</td>
                <td>
                  <b class="ink">{{ AUDIT_ACTION_LABEL[a.action] ?? a.action }}</b>
                </td>
                <td>{{ a.actor?.nameMasked ?? '-' }}</td>
                <td>{{ a.target?.nameMasked ?? '-' }}</td>
                <td>{{ detailText(a) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul class="cards mob">
          <li v-for="a in audit" :key="a.auditId" class="card">
            <span class="row-between">
              <b class="title-sm">{{ AUDIT_ACTION_LABEL[a.action] ?? a.action }}</b>
              <span class="caption">{{ fmtDate(a.at, true) }}</span>
            </span>
            <span class="body-sm">{{ a.actor?.nameMasked ?? '-' }} → {{ a.target?.nameMasked ?? '-' }}</span>
            <span class="caption">{{ detailText(a) }}</span>
          </li>
        </ul>
      </template>
    </section>

    <!-- 게이트 이벤트 -->
    <section v-else-if="tab === 'gates' && canGate" aria-labelledby="ad-g">
      <h2 id="ad-g" class="title-lg">게이트 이벤트</h2>
      <p class="caption">최근 200건 · 차단과 해제 기록</p>
      <div v-if="!gatesEv" class="skeleton" style="height: 200px"></div>
      <p v-else-if="!gatesEv.length" class="empty">기록이 없습니다</p>
      <template v-else>
        <div class="table-wrap desk">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">발생</th>
                <th scope="col">게이트</th>
                <th scope="col">대상</th>
                <th scope="col">사유</th>
                <th scope="col">상태</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in gatesEv" :key="g.eventId">
                <td class="nowrap">{{ fmtDate(g.occurredAt, true) }}</td>
                <td>
                  <span class="gcode">{{ g.gateCode }}</span>
                </td>
                <td class="nowrap">{{ SUBJECT_LABEL[g.subjectKind] ?? g.subjectKind }} #{{ g.subjectId }}</td>
                <td>{{ g.reason ?? '-' }}</td>
                <td>
                  <StatusBadge :tone="g.releasedAt ? 'ok' : 'danger'" :label="g.releasedAt ? '해제' : '차단 중'" />
                  <span v-if="g.releasedAt" class="caption sub"
                    >{{ fmtDate(g.releasedAt, true) }}<template v-if="g.releaseAction"> · {{ g.releaseAction }}</template></span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul class="cards mob">
          <li v-for="g in gatesEv" :key="g.eventId" class="card">
            <span class="row-between">
              <span class="row"
                ><span class="gcode">{{ g.gateCode }}</span
                ><StatusBadge :tone="g.releasedAt ? 'ok' : 'danger'" :label="g.releasedAt ? '해제' : '차단 중'"
              /></span>
              <span class="caption">{{ fmtDate(g.occurredAt, true) }}</span>
            </span>
            <span class="body-sm">{{ g.reason ?? '-' }}</span>
            <span class="caption"
              >{{ SUBJECT_LABEL[g.subjectKind] ?? g.subjectKind }} #{{ g.subjectId
              }}<template v-if="g.releasedAt"> · 해제 {{ fmtDate(g.releasedAt, true) }}</template></span
            >
          </li>
        </ul>
      </template>
    </section>
  </div>
</template>

<style scoped>
.nowrap {
  white-space: nowrap;
}
.ink {
  color: var(--ink);
}
.sub {
  display: block;
  margin-top: 4px;
}
.gcode {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--ink);
  color: var(--ink);
  font: var(--t-caption);
  font-weight: 700;
}
.cards {
  display: none;
  border-top: 1px solid var(--ink);
}
.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--s-sm) 0;
  border-bottom: 1px solid var(--hairline);
}
.desk {
  margin-top: var(--s-sm);
}
@media (max-width: 767px) {
  .desk {
    display: none;
  }
  .cards {
    display: flex;
    flex-direction: column;
    margin-top: var(--s-sm);
  }
}
</style>
