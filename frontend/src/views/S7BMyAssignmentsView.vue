<script setup lang="ts">
/**
 * S7B 내 배정 점검 (UC6 · FR-075 · SD_02 §10 S7B) — 시설관리자 모바일 작업 목록.
 * 지연 → 도래 → 예정 순(서버 정렬 = v_schedule_status). 추가 자료 요청 카드는 S4 와 같은 G6 문구.
 */
import { computed, onMounted, ref } from 'vue';
import { get, errorMessage, type GateBlock } from '@/api/client';
import { useGates } from '@/stores/gates';
import { fmtDate } from '@/composables/useCan';
import C1ProgressRail from '@/components/common/C1ProgressRail.vue';
import C2GateBlock from '@/components/common/C2GateBlock.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import CategoryTabs from '@/components/base/CategoryTabs.vue';
import HistoryCard from '@/components/base/HistoryCard.vue';
import RetryBox from '@/components/base/RetryBox.vue';
import AlertBox from '@/components/base/AlertBox.vue';

interface Schedule {
  scheduleId: number;
  buildingId: number;
  buildingName: string;
  itemText: string;
  dueDate: string;
  displayStatus: 'scheduled' | 'due' | 'overdue';
  cycleName: string | null;
}
interface DataReq {
  dataReqId: number;
  caseNo: string;
  reason: string;
  sentAt: string;
  recordId: number;
  buildingId: number;
  buildingName: string;
}

const gates = useGates();
const data = ref<{
  rail: { assigned: number; due: number; overdue: number; dataRequests: number };
  schedules: Schedule[];
  dataRequests: DataReq[];
} | null>(null);
const loading = ref(true);
const err = ref('');
const tab = ref('assigned');

async function load() {
  loading.value = true;
  err.value = '';
  try {
    data.value = await get('/api/me/assignments');
    if (tab.value === 'assigned' && !data.value!.schedules.length && data.value!.dataRequests.length) tab.value = 'requests';
  } catch (e) {
    err.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const counts = computed(() => {
  const r = data.value?.rail;
  return [
    { label: '배정', value: r?.assigned ?? 0 },
    { label: '지연', value: r?.overdue ?? 0, alert: true },
    { label: '추가 자료 요청', value: r?.dataRequests ?? 0, alert: true },
  ];
});
const tabs = computed(() => [
  { value: 'assigned', label: '배정', count: data.value?.rail.assigned ?? null },
  { value: 'due', label: '도래', count: data.value?.rail.due ?? null },
  { value: 'overdue', label: '지연', count: data.value?.rail.overdue ?? null },
  { value: 'requests', label: '자료 요청', count: data.value?.rail.dataRequests ?? null },
]);
const schedules = computed(() => {
  const all = data.value?.schedules ?? [];
  if (tab.value === 'due') return all.filter((s) => s.displayStatus === 'due');
  if (tab.value === 'overdue') return all.filter((s) => s.displayStatus === 'overdue');
  return all;
});

const STATUS: Record<string, { tone: 'warn' | 'info'; label: string }> = {
  overdue: { tone: 'warn', label: '지연' },
  due: { tone: 'info', label: '도래' },
  scheduled: { tone: 'info', label: '예정' },
};
function dueLine(s: Schedule) {
  if (s.displayStatus === 'overdue') return `기한 ${fmtDate(s.dueDate)} 경과`;
  return `기한 ${fmtDate(s.dueDate)}`;
}
function startTo(s: Schedule) {
  return { path: '/records/new', query: { buildingId: String(s.buildingId), scheduleId: String(s.scheduleId) } };
}
/** G6 문구는 gate_def 단일 원천. 시설관리자에게는 본인 해제(사진 추가) */
function g6Block(d: DataReq): GateBlock {
  return {
    gate: 'G6',
    message: gates.messageOf('G6'),
    reason: `사유: ${d.reason} - ${d.caseNo}`,
    releaseParty: gates.releasePartyOf('G6'),
    selfRelease: true,
    actions: [{ id: 'upload', label: '재촬영 사진 올리기', href: `/records/${d.recordId}` }],
  };
}
</script>

<template>
  <div>
    <C1ProgressRail variant="worker" title="내 작업" :counts="counts" />
    <div class="container page">
      <div class="page-head">
        <div>
          <p class="eyebrow">오늘의 현장 업무</p>
          <h1 class="display-md">내 배정 점검</h1>
          <p class="body-md muted" style="margin-top: 8px">지연된 점검부터 위에 보입니다. 현장 기록을 저장하면 일정이 완료됩니다.</p>
        </div>
        <BaseButton variant="secondary" size="sm" to="/records">내 현장 기록</BaseButton>
      </div>

      <RetryBox v-if="err" :message="err" :busy="loading" @retry="load" />

      <CategoryTabs v-model="tab" :tabs="tabs" label="배정 점검 구분" />

      <div v-if="loading && !data" class="cards" aria-label="불러오는 중">
        <p v-for="i in 3" :key="i" class="skeleton" style="height: 140px"></p>
      </div>

      <template v-else-if="data">
        <!-- 자료 요청 탭 -->
        <section v-if="tab === 'requests'" class="cards" aria-label="추가 자료 요청">
          <p v-if="!data.dataRequests.length" class="empty">받은 추가 자료 요청이 없습니다</p>
          <article v-for="d in data.dataRequests" :key="d.dataReqId" class="req-card">
            <p class="caption">추가 자료 요청 - 전문가 검증 · {{ d.buildingName }} · {{ fmtDate(d.sentAt, true) }}</p>
            <C2GateBlock :block="g6Block(d)" compact />
          </article>
        </section>

        <!-- 일정 탭 -->
        <section v-else class="cards" :aria-label="tabs.find((t) => t.value === tab)?.label">
          <AlertBox
            v-if="tab === 'assigned' && data.dataRequests.length"
            tone="warn"
            :title="`추가 자료 요청 ${data.dataRequests.length}건`"
          >
            전문가가 현장 사진을 더 요청했습니다.
            <button type="button" class="link" @click="tab = 'requests'">자료 요청 보기</button>
          </AlertBox>
          <p v-if="!schedules.length" class="empty">
            {{ tab === 'overdue' ? '지연된 점검이 없습니다' : tab === 'due' ? '기한이 도래한 점검이 없습니다' : '배정된 점검이 없습니다' }}
          </p>
          <HistoryCard
            v-for="s in schedules"
            :key="s.scheduleId"
            as="div"
            :class="['sched', `st-${s.displayStatus}`]"
            :title="s.itemText"
            :meta="`${s.buildingName}${s.cycleName ? ` · ${s.cycleName} 주기` : ''}`"
          >
            <template #badges>
              <StatusBadge :tone="STATUS[s.displayStatus].tone" :label="STATUS[s.displayStatus].label" size="md" />
            </template>
            <p class="due" :class="{ late: s.displayStatus === 'overdue' }">{{ dueLine(s) }}</p>
            <template #actions>
              <BaseButton block :to="startTo(s)">현장 기록 시작</BaseButton>
            </template>
          </HistoryCard>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cards {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  margin-top: var(--s-md);
  max-width: 720px;
}
.req-card {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--hairline);
  padding: var(--s-sm) var(--s-sm) 0;
}
.req-card :deep(.gate) {
  margin: var(--s-xs) 0 var(--s-sm);
}
.sched.st-overdue {
  border-left: 4px solid var(--warning);
}
.due {
  font: var(--t-body-sm);
  color: var(--body);
}
.due.late {
  font-weight: 700;
  color: var(--warning-text);
}
.link {
  background: none;
  border: 0;
  padding: 0;
  min-height: var(--touch);
  color: var(--primary);
  font: var(--t-body-sm);
  font-weight: 700;
  cursor: pointer;
}
.sched :deep(.actions) {
  width: 100%;
}
</style>
