<script setup lang="ts">
/**
 * S8A 전문가 연결 홈 (UC7 · 건물관리자)
 * - 열린 위험 통지: 출처 · 건 번호 · 건물 · 위험도 · 1순위 원인 → [전문가 점검 요청] (S8A, 하자 건·출처 자동 선택) · [조치 없음 종료](화면 안 확인)
 * - 내 요청: 작성 중 · 수락 대기 · 미확정 · 연결 확정 · 종료 → 상세
 */
import { computed, onMounted, ref } from 'vue';
import { get, post, newIdempotencyKey, GateBlockError, errorMessage, type GateBlock } from '@/api/client';
import { useSession } from '@/stores/session';
import { RISK_LABEL, riskTone, fmtDate } from '@/composables/useCan';
import { requestStatus } from '@/components/expert/expertLabels';
import StatusBadge from '@/components/common/StatusBadge.vue';
import C2GateBlock from '@/components/common/C2GateBlock.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import FilterChips from '@/components/base/FilterChips.vue';
import RetryBox from '@/components/base/RetryBox.vue';

const session = useSession();

const notices = ref<any[]>([]);
const requests = ref<any[]>([]);
const loadingN = ref(true);
const loadingR = ref(true);
const errN = ref('');
const errR = ref('');
const gate = ref<GateBlock | null>(null);
const scope = ref<'open' | 'all'>('open');
const statusFilter = ref('all');

const confirming = ref<number | null>(null);
const dismissBusy = ref<number | null>(null);
const dismissErr = ref<{ id: number; msg: string } | null>(null);

const canDismiss = computed(() => session.can('risk_notice.dismiss'));

async function loadNotices() {
  loadingN.value = true;
  errN.value = '';
  try {
    notices.value = await get('/api/risk-notices', scope.value === 'all' ? { all: 1 } : undefined);
  } catch (e) {
    if (e instanceof GateBlockError) gate.value = e.block;
    else errN.value = errorMessage(e);
  } finally {
    loadingN.value = false;
  }
}
async function loadRequests() {
  loadingR.value = true;
  errR.value = '';
  try {
    requests.value = await get('/api/expert-requests');
  } catch (e) {
    if (e instanceof GateBlockError) gate.value = e.block;
    else errR.value = errorMessage(e);
  } finally {
    loadingR.value = false;
  }
}

function setScope(v: string) {
  scope.value = v as 'open' | 'all';
  confirming.value = null;
  loadNotices();
}

async function dismiss(id: number) {
  if (dismissBusy.value) return;
  dismissBusy.value = id;
  dismissErr.value = null;
  try {
    await post(`/api/risk-notices/${id}/dismiss`, {}, { idempotencyKey: newIdempotencyKey() });
    confirming.value = null;
    await loadNotices();
  } catch (e) {
    if (e instanceof GateBlockError) gate.value = e.block;
    else dismissErr.value = { id, msg: errorMessage(e) };
  } finally {
    dismissBusy.value = null;
  }
}

function newTo(n: any) {
  return { path: '/expert-requests/new', query: { caseId: String(n.caseId), riskNoticeId: String(n.riskNoticeId), origin: n.sourceKind } };
}

const STATUS_OPTS = [
  { value: 'all', label: '전체' },
  { value: 'drafting', label: '작성 중' },
  { value: 'awaiting', label: '수락 대기' },
  { value: 'not_confirmed', label: '미확정' },
  { value: 'connected', label: '연결 확정' },
  { value: 'closed', label: '종료' },
];
const shownRequests = computed(() =>
  statusFilter.value === 'all' ? requests.value : requests.value.filter((r) => r.status === statusFilter.value),
);
const counts = computed(() => {
  const c: Record<string, number> = {};
  for (const r of requests.value) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
});

const CLOSE_REASON: Record<string, string> = { dismissed: '조치 없음 종료', connected: '전문가 연결 확정' };

onMounted(() => {
  loadNotices();
  loadRequests();
});
</script>

<template>
  <div class="container page">
    <div class="page-head">
      <div>
        <p class="eyebrow">전문가 점검 연결</p>
        <h1 class="display-md">전문가 점검 요청</h1>
        <p class="body-md muted" style="margin-top: 8px">위험 통지를 확인하고 전문가 점검을 요청하거나, 조치가 필요 없으면 종료합니다.</p>
      </div>
      <div class="head-counts" aria-label="요청 현황">
        <StatusBadge tone="info" :label="`수락 대기 ${counts.awaiting ?? 0}`" />
        <StatusBadge tone="warn" :label="`미확정 ${counts.not_confirmed ?? 0}`" />
        <StatusBadge tone="ok" :label="`연결 확정 ${counts.connected ?? 0}`" />
      </div>
    </div>

    <C2GateBlock v-if="gate" :block="gate" />

    <div class="layout">
      <!-- ===================================================== 위험 통지 -->
      <section class="stack" aria-labelledby="s8a-notices">
        <div class="row-between">
          <h2 id="s8a-notices" class="title-lg">위험 통지</h2>
          <FilterChips
            label="위험 통지 범위"
            :model-value="scope"
            :options="[
              { value: 'open', label: '열린 통지' },
              { value: 'all', label: '종료 포함' },
            ]"
            @update:model-value="setScope"
          />
        </div>
        <RetryBox v-if="errN" :message="errN" @retry="loadNotices" />
        <p v-else-if="loadingN" class="empty" role="status">불러오는 중</p>
        <p v-else-if="!notices.length" class="empty">{{ scope === 'open' ? '열린 위험 통지가 없습니다' : '위험 통지가 없습니다' }}</p>
        <ul v-else class="cards">
          <li v-for="n in notices" :key="n.riskNoticeId" class="card" :class="{ closed: !n.open }">
            <div class="card-top">
              <span class="label-upper src">{{ n.sourceLabel }}</span>
              <StatusBadge v-if="n.riskLevel" :tone="riskTone(n.riskLevel)" :label="`위험도 ${RISK_LABEL[n.riskLevel] ?? n.riskLevel}`" />
              <StatusBadge v-if="!n.open" tone="na" :label="CLOSE_REASON[n.closeReason] ?? '종료'" />
            </div>
            <p class="title-sm">{{ n.caseNo }} · {{ n.buildingName }}</p>
            <p class="body-sm"><span class="muted">1순위 원인 </span>{{ n.topCause || '분석 원인 없음' }}</p>
            <p class="caption">
              통지 {{ fmtDate(n.createdAt, true) }}<template v-if="n.closedAt"> · 종료 {{ fmtDate(n.closedAt, true) }}</template>
            </p>

            <div v-if="n.open" class="card-actions">
              <BaseButton v-if="n.expReqId" size="sm" :to="`/expert-requests/${n.expReqId}`">진행 중인 요청 보기</BaseButton>
              <BaseButton v-else size="sm" :to="newTo(n)">전문가 점검 요청</BaseButton>
              <BaseButton
                v-if="canDismiss && confirming !== n.riskNoticeId"
                variant="secondary"
                size="sm"
                @click="confirming = n.riskNoticeId"
              >
                조치 없음 종료
              </BaseButton>
            </div>
            <div v-if="n.open && confirming === n.riskNoticeId" class="confirm" role="group" :aria-labelledby="`dismiss-${n.riskNoticeId}`">
              <p :id="`dismiss-${n.riskNoticeId}`" class="body-sm">
                <b>{{ n.caseNo }}</b> 위험 통지를 조치 없이 종료할까요? 열린 목록에서 사라지고 종료 이력은 남습니다.
              </p>
              <p v-if="dismissErr?.id === n.riskNoticeId" class="body-sm err" role="alert">{{ dismissErr?.msg }}</p>
              <div class="row">
                <BaseButton size="sm" :busy="dismissBusy === n.riskNoticeId" @click="dismiss(n.riskNoticeId)">종료 확인</BaseButton>
                <BaseButton variant="secondary" size="sm" :disabled="dismissBusy === n.riskNoticeId" @click="confirming = null"
                  >취소</BaseButton
                >
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- ===================================================== 내 요청 -->
      <section class="stack" aria-labelledby="s8a-requests">
        <h2 id="s8a-requests" class="title-lg">내 요청</h2>
        <FilterChips v-model="statusFilter" label="요청 상태" :options="STATUS_OPTS" />
        <RetryBox v-if="errR" :message="errR" @retry="loadRequests" />
        <p v-else-if="loadingR" class="empty" role="status">불러오는 중</p>
        <p v-else-if="!shownRequests.length" class="empty">
          {{ requests.length ? '해당 상태의 요청이 없습니다' : '아직 보낸 요청이 없습니다' }}
        </p>
        <ul v-else class="reqs">
          <li v-for="r in shownRequests" :key="r.expReqId">
            <RouterLink class="req-item" :to="`/expert-requests/${r.expReqId}`">
              <span class="row">
                <b class="title-sm">{{ r.caseNo }}</b>
                <StatusBadge :tone="requestStatus(r.status).tone" :label="requestStatus(r.status).label" />
              </span>
              <span class="body-sm">{{ r.buildingName }} · {{ r.specialtyName }}</span>
              <span class="caption">요청 #{{ r.expReqId }} · {{ fmtDate(r.createdAt, true) }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.head-counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--s-xl);
  align-items: start;
}
.cards {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.card {
  border: 1px solid var(--hairline);
  padding: var(--s-md);
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  background: var(--canvas);
}
.card.closed {
  background: var(--surface-soft);
}
.card-top {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
  align-items: center;
}
.src {
  color: var(--ink);
}
.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
  margin-top: var(--s-xs);
}
.confirm {
  border-top: 1px solid var(--hairline);
  padding-top: var(--s-sm);
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.err {
  color: var(--error-text);
}
.reqs {
  border-top: 1px solid var(--hairline);
}
.req-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 64px;
  padding: var(--s-sm) 0;
  border-bottom: 1px solid var(--hairline);
  color: inherit;
  text-decoration: none;
}
.req-item:hover .title-sm {
  color: var(--primary);
}
.req-item:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
@media (max-width: 1023px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
