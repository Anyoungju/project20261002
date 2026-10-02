<script setup lang="ts">
/**
 * S3 진입 — 내 현장 기록 목록 (UC3). 작성 중(draft)이 맨 위, 추가 자료 요청이 열린 기록은 강조.
 * [새 기록] → /records/new
 */
import { computed, onMounted, ref } from 'vue';
import { get, errorMessage } from '@/api/client';
import { useSession } from '@/stores/session';
import { fmtDate } from '@/composables/useCan';
import StatusBadge from '@/components/common/StatusBadge.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import FilterChips from '@/components/base/FilterChips.vue';
import RetryBox from '@/components/base/RetryBox.vue';
import AlertBox from '@/components/base/AlertBox.vue';

interface Row {
  recordId: number;
  caseNo: string;
  buildingName: string;
  locationText: string | null;
  defectTypeName: string | null;
  recordStatus: 'draft' | 'saved';
  repairStatus: 'completed' | 'pending' | null;
  createdAt: string;
  savedAt: string | null;
  openDataRequests: number;
}

const session = useSession();
const rows = ref<Row[]>([]);
const loading = ref(true);
const err = ref('');
const filter = ref('all');

async function load() {
  loading.value = true;
  err.value = '';
  try {
    rows.value = await get<Row[]>('/api/records');
  } catch (e) {
    err.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const rank = (r: Row) => (r.recordStatus === 'draft' ? 0 : r.openDataRequests > 0 ? 1 : 2);
const sorted = computed(() =>
  rows.value
    .filter((r) => filter.value === 'all' || (filter.value === 'request' ? r.openDataRequests > 0 : r.recordStatus === filter.value))
    .slice()
    .sort((a, b) => rank(a) - rank(b) || b.recordId - a.recordId),
);
const draftCount = computed(() => rows.value.filter((r) => r.recordStatus === 'draft').length);
const reqCount = computed(() => rows.value.filter((r) => r.openDataRequests > 0).length);
const chips = computed(() => [
  { value: 'all', label: `전체 ${rows.value.length}` },
  { value: 'draft', label: `작성 중 ${draftCount.value}` },
  { value: 'request', label: `자료 요청 ${reqCount.value}` },
  { value: 'saved', label: '저장됨' },
]);
</script>

<template>
  <div class="container page">
    <div class="page-head">
      <div>
        <p class="eyebrow">현장 점검·보수 기록</p>
        <h1 class="display-md">내 현장 기록</h1>
        <p class="body-md muted" style="margin-top: 8px">작성 중인 기록과 전문가의 추가 자료 요청이 먼저 보입니다.</p>
      </div>
      <div class="row">
        <BaseButton v-if="session.can('schedule.read.assigned')" variant="secondary" to="/me/assignments">내 배정 점검</BaseButton>
        <BaseButton to="/records/new">새 기록</BaseButton>
      </div>
    </div>

    <RetryBox v-if="err" :message="err" :busy="loading" @retry="load" />

    <AlertBox v-if="reqCount" tone="warn" :title="`추가 자료 요청 ${reqCount}건`" style="margin-bottom: 16px">
      전문가가 현장 사진을 더 요청했습니다. 기록을 열어 사진을 추가하면 요청이 해소됩니다.
    </AlertBox>

    <FilterChips v-model="filter" :options="chips" label="기록 상태" />

    <div v-if="loading && !rows.length" class="list" aria-label="불러오는 중">
      <p v-for="i in 4" :key="i" class="skeleton" style="height: 72px"></p>
    </div>
    <p v-else-if="!sorted.length" class="empty" style="margin-top: 16px">
      {{ rows.length ? '조건에 맞는 기록이 없습니다' : '아직 작성한 현장 기록이 없습니다 - [새 기록]으로 시작하세요' }}
    </p>
    <ul v-else class="list">
      <li v-for="r in sorted" :key="r.recordId">
        <RouterLink :to="`/records/${r.recordId}`" class="item" :class="{ hl: r.openDataRequests > 0, draft: r.recordStatus === 'draft' }">
          <span class="row">
            <b class="title-sm">{{ r.caseNo }}</b>
            <StatusBadge v-if="r.recordStatus === 'draft'" tone="info" label="작성 중" />
            <StatusBadge v-else tone="ok" label="저장됨" />
            <StatusBadge v-if="r.openDataRequests > 0" tone="warn" :label="`추가 자료 요청 ${r.openDataRequests}`" />
            <StatusBadge v-if="r.recordStatus === 'saved' && r.repairStatus === 'pending'" tone="na" label="보수 미완료" />
          </span>
          <span class="body-sm"
            >{{ r.buildingName }} · {{ r.locationText || '위치 미입력' }} · {{ r.defectTypeName || '하자 종류 미입력' }}</span
          >
          <span class="caption">{{
            r.recordStatus === 'saved' ? `저장 ${fmtDate(r.savedAt, true)}` : `작성 시작 ${fmtDate(r.createdAt, true)}`
          }}</span>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  margin-top: var(--s-md);
  border-top: 1px solid var(--hairline);
}
.list .skeleton {
  margin-top: var(--s-xs);
}
.item {
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
  min-height: 72px;
  padding: var(--s-sm) var(--s-md);
  border-bottom: 1px solid var(--hairline);
  color: var(--body);
  text-decoration: none;
}
.item:hover {
  background: var(--surface-soft);
  text-decoration: none;
}
.item.draft {
  border-left: 4px solid var(--ink);
}
.item.hl {
  border-left: 4px solid var(--warning);
  background: var(--warning-tint);
}
</style>
