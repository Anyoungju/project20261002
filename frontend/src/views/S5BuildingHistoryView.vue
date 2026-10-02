<script setup lang="ts">
/**
 * S5 건물별 유지관리 이력·반복 하자 (UC5 · P5 · SD_02 §8) — 읽기 전용(FR-055).
 * 통합 이력: v_building_history 시간순 + 외부 연동 실패는 C7(막지 않음, FR-052).
 * 반복 하자: v_pattern_gate 미통과면 G7 C2 블록 + 후속 버튼 C3(G7) 비활성.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get, post, errorMessage, GateBlockError, type GateBlock, type GateAction } from '@/api/client';
import { useSession } from '@/stores/session';
import { useReference } from '@/stores/reference';
import { RISK_LABEL, riskTone, fmtDate } from '@/composables/useCan';
import C1ProgressRail from '@/components/common/C1ProgressRail.vue';
import C2GateBlock from '@/components/common/C2GateBlock.vue';
import C3ReasonedButton from '@/components/common/C3ReasonedButton.vue';
import C7SourceStatusBar from '@/components/common/C7SourceStatusBar.vue';
import C8BuildingPicker, { type BuildingItem } from '@/components/common/C8BuildingPicker.vue';
import G0Block from '@/components/common/G0Block.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import CategoryTabs from '@/components/base/CategoryTabs.vue';
import FilterChips from '@/components/base/FilterChips.vue';
import HistoryCard from '@/components/base/HistoryCard.vue';
import RetryBox from '@/components/base/RetryBox.vue';
import HistoryEntryDetail from '@/components/building/HistoryEntryDetail.vue';

type Tone = 'ok' | 'warn' | 'danger' | 'ref' | 'na' | 'info';

const route = useRoute();
const router = useRouter();
const session = useSession();
const reference = useReference();

const buildings = ref<BuildingItem[]>([]);
const buildingId = computed<number | null>(() => (route.query.buildingId ? Number(route.query.buildingId) || null : null));
const tab = computed(() => (route.query.tab === 'repeat' ? 'repeat' : 'history'));
const building = computed(() => buildings.value.find((b) => b.buildingId === buildingId.value) ?? null);

function setQuery(patch: Record<string, string | undefined>) {
  const q: Record<string, any> = { ...route.query, ...patch };
  for (const k of Object.keys(q)) if (q[k] === undefined || q[k] === '') delete q[k];
  router.replace({ query: q });
}
function onPick(id: number | null) {
  setQuery({ buildingId: id ? String(id) : undefined });
}
function onTab(v: string) {
  setQuery({ tab: v === 'repeat' ? 'repeat' : undefined });
}

// ---------------------------------------------------------------- 필터
const period = ref('all');
const defectType = ref('');
const PERIODS = [
  { value: 'all', label: '전체' },
  { value: '30', label: '최근 30일' },
  { value: '90', label: '최근 90일' },
  { value: '365', label: '최근 1년' },
];
const defectOptions = computed(() => [
  { value: '', label: '전체' },
  ...reference.defectTypes.map((d) => ({ value: d.code, label: d.name })),
]);
function dateBefore(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- 데이터
const rail = ref<any | null>(null);
const history = ref<{ source: any; entries: any[] } | null>(null);
const histLoading = ref(false);
const histErr = ref('');
const accessBlock = ref<GateBlock | null>(null);
const repeat = ref<any | null>(null);
const repLoading = ref(false);
const repErr = ref('');
const openKey = ref<string | null>(null);
const syncBusy = ref(false);
const syncMsg = ref('');

async function loadRail() {
  if (!buildingId.value) return;
  try {
    rail.value = await get(`/api/buildings/${buildingId.value}/rail`);
  } catch {
    rail.value = null;
  }
}
async function loadHistory() {
  const id = buildingId.value;
  if (!id) return;
  histLoading.value = true;
  histErr.value = '';
  try {
    const r = await get(`/api/buildings/${id}/history`, {
      from: period.value === 'all' ? undefined : dateBefore(Number(period.value)),
      defectType: defectType.value || undefined,
    });
    if (id !== buildingId.value) return;
    history.value = r;
    accessBlock.value = null;
  } catch (e) {
    if (e instanceof GateBlockError) accessBlock.value = e.block;
    else histErr.value = errorMessage(e);
  } finally {
    histLoading.value = false;
  }
}
async function loadRepeat() {
  const id = buildingId.value;
  if (!id) return;
  repLoading.value = true;
  repErr.value = '';
  try {
    const r = await get(`/api/buildings/${id}/repeat-defects`);
    if (id !== buildingId.value) return;
    repeat.value = r;
    accessBlock.value = null;
  } catch (e) {
    if (e instanceof GateBlockError) accessBlock.value = e.block;
    else repErr.value = errorMessage(e);
  } finally {
    repLoading.value = false;
  }
}
function loadTab() {
  if (tab.value === 'repeat') {
    if (!repeat.value) loadRepeat();
  } else if (!history.value) loadHistory();
}

watch(buildingId, () => {
  rail.value = null;
  history.value = null;
  repeat.value = null;
  openKey.value = null;
  accessBlock.value = null;
  syncMsg.value = '';
  if (!buildingId.value) return;
  loadRail();
  loadTab();
});
watch(tab, loadTab);
watch([period, defectType], () => {
  openKey.value = null;
  loadHistory();
});
onMounted(() => {
  reference.load().catch(() => undefined);
  if (buildingId.value) {
    loadRail();
    loadTab();
  }
});

async function syncNow() {
  if (!buildingId.value || syncBusy.value) return;
  syncBusy.value = true;
  syncMsg.value = '';
  try {
    const r = await post<{ status: string; added: number; error?: string }>(`/api/buildings/${buildingId.value}/bms-sync`);
    syncMsg.value =
      r.status === 'ok'
        ? `동기화 완료 - 새 외부 이력 ${r.added}건`
        : r.status === 'skipped'
          ? '건물관리시스템이 연결되지 않은 건물입니다'
          : '동기화 실패 - 내부 이력만 표시합니다';
    await Promise.all([loadRail(), loadHistory(), repeat.value ? loadRepeat() : Promise.resolve()]);
  } catch (e) {
    syncMsg.value = errorMessage(e);
  } finally {
    syncBusy.value = false;
  }
}

// ---------------------------------------------------------------- 표시
const source = computed(() => history.value?.source ?? repeat.value?.source ?? rail.value?.source ?? null);
const c7Items = computed(() => {
  const s = source.value;
  if (!s?.externalMissing) return [];
  return [
    {
      key: 'external',
      label: '외부 이력 미반영 - 연동 실패',
      detail:
        (s.errorMessage ? `${s.errorMessage}. ` : s.lastSyncAt ? '' : '건물관리시스템과 아직 동기화되지 않았습니다. ') +
        `내부 이력만 표시 중입니다${s.lastSyncAt ? ` (마지막 시도 ${fmtDate(s.lastSyncAt, true)})` : ''}.`,
    },
  ];
});
const railCounts = computed(() =>
  rail.value
    ? [
        { label: '이력', value: rail.value.historyCount },
        { label: '정기점검 지연', value: rail.value.overdueCount, alert: true },
        { label: '전문가 연결 대기', value: rail.value.awaitingCount, alert: true },
      ]
    : [],
);

function outcomeBadge(e: any): { tone: Tone; label: string } | null {
  switch (e.entryKind) {
    case 'ai_analysis':
      return e.outcome ? { tone: riskTone(e.outcome), label: `위험도 ${RISK_LABEL[e.outcome] ?? e.outcome}` } : null;
    case 'field_record':
      return e.outcome === 'completed' ? { tone: 'ok', label: '보수 완료' } : { tone: 'warn', label: '보수 미완료' };
    case 'expert_verdict':
      return e.outcome === 'match' ? { tone: 'ok', label: '판정 일치' } : { tone: 'warn', label: '판정 불일치' };
    case 'expert_connection':
      return { tone: 'ok', label: '연결 확정' };
    default:
      return null;
  }
}
function cardTitle(e: any) {
  const where = [e.locationText, e.defectTypeName].filter(Boolean).join(' · ');
  return where ? `${e.entryKindLabel} · ${where}` : e.entryKindLabel;
}
function cardMeta(e: any) {
  return [fmtDate(e.occurredAt, e.entryKind !== 'external'), e.caseNo ? `하자 건 ${e.caseNo}` : null].filter(Boolean).join(' · ');
}
function toggle(e: any) {
  openKey.value = openKey.value === e.entryKey ? null : e.entryKey;
}
const entries = computed(() => history.value?.entries ?? []);
const tabs = computed(() => [
  { value: 'history', label: '통합 이력', count: history.value ? entries.value.length : null },
  { value: 'repeat', label: '반복 하자', count: repeat.value && !repeat.value.blocked ? repeat.value.patterns.length : null },
]);

// ---------------------------------------------------------------- 반복 하자 → 후속
function scheduleTo(p: { locationText: string; defectTypeCode: string; defectTypeName: string }) {
  return {
    path: '/schedules',
    query: {
      buildingId: String(buildingId.value),
      item: `${p.locationText} ${p.defectTypeName} 반복 점검`,
      location: p.locationText,
      defectType: p.defectTypeCode,
    },
  };
}
function expertTo(p: { latestCaseId: number }) {
  return { path: '/expert-requests/new', query: { caseId: String(p.latestCaseId), origin: 'history' } };
}
const canSchedule = computed(() => session.can('schedule.manage'));
const canExpert = computed(() => session.can('expert_request.create'));
function expertReason(p: any) {
  if (!canExpert.value) return '전문가 점검 요청 권한이 없습니다';
  if (!p.latestCaseId) return '외부 이력만 있는 패턴이라 연결할 하자 건이 없습니다 - 현장 기록을 먼저 남겨 주세요';
  return null;
}
function onG7Action(a: GateAction) {
  if (a.id === 'request-records') {
    router.push({ path: '/schedules', query: { buildingId: String(buildingId.value), item: '반복 하자 판단용 현장 기록 축적 점검' } });
  }
}
</script>

<template>
  <div>
    <C1ProgressRail v-if="rail" variant="building" :title="rail.buildingName" :counts="railCounts" />
    <div class="container page">
      <div class="page-head">
        <div>
          <p class="eyebrow">건물 관리</p>
          <h1 class="display-md">건물 유지관리 이력</h1>
          <p class="body-md muted" style="margin-top: 8px">
            내부·외부 이력을 시간순으로 보고 같은 위치에서 반복되는 하자를 확인합니다. 이 화면에서는 이력을 고칠 수 없습니다.
          </p>
        </div>
        <div class="picker">
          <C8BuildingPicker
            :model-value="buildingId"
            access="manage"
            screen="S5"
            label="건물"
            @update:model-value="onPick"
            @loaded="buildings = $event"
          />
        </div>
      </div>

      <p v-if="!buildingId" class="empty">이력을 볼 건물을 선택하세요</p>

      <G0Block v-else-if="accessBlock" screen="S5" :building-id="buildingId" :block="accessBlock" />

      <template v-else>
        <div v-if="c7Items.length || (session.can('building.bms.sync') && source?.connected)" class="source-row">
          <C7SourceStatusBar :items="c7Items" />
          <div v-if="session.can('building.bms.sync') && source?.connected" class="row">
            <BaseButton variant="secondary" size="sm" :busy="syncBusy" @click="syncNow">지금 동기화</BaseButton>
            <span v-if="syncMsg" class="caption" role="status">{{ syncMsg }}</span>
          </div>
        </div>

        <CategoryTabs :tabs="tabs" :model-value="tab" label="건물 이력 보기" @update:model-value="onTab" />

        <!-- ================================================= 통합 이력 -->
        <section v-if="tab === 'history'" class="stack-lg" role="tabpanel" aria-label="통합 이력">
          <div class="filters">
            <div class="filter">
              <span class="field-label">기간</span>
              <FilterChips v-model="period" :options="PERIODS" label="기간" />
            </div>
            <div class="filter">
              <span class="field-label">하자 종류</span>
              <FilterChips v-model="defectType" :options="defectOptions" label="하자 종류" />
            </div>
          </div>

          <RetryBox v-if="histErr" :message="histErr" :busy="histLoading" @retry="loadHistory" />
          <div v-else-if="histLoading && !history" class="grid-3">
            <p v-for="i in 3" :key="i" class="skeleton" style="height: 140px"></p>
          </div>
          <p v-else-if="history && !entries.length" class="empty">조건에 맞는 이력이 없습니다</p>
          <template v-else-if="history">
            <p class="caption" aria-live="polite">{{ entries.length }}건 · 최신순<template v-if="histLoading"> · 불러오는 중</template></p>
            <ul class="timeline">
              <template v-for="e in entries" :key="e.entryKey">
                <HistoryCard as="li" :title="cardTitle(e)" :meta="cardMeta(e)" :class="{ 'is-open': openKey === e.entryKey }">
                  <template #badges>
                    <StatusBadge tone="na" :label="e.origin === 'external' ? '외부' : '내부'" />
                    <StatusBadge v-if="outcomeBadge(e)" :tone="outcomeBadge(e)!.tone" :label="outcomeBadge(e)!.label" />
                    <StatusBadge v-if="e.entryKind === 'ai_analysis'" tone="ref" label="1차 참고용" />
                  </template>
                  <p v-if="e.entryKind === 'external' && e.outcome" class="body-sm">{{ e.outcome }}</p>
                  <template #actions>
                    <button
                      type="button"
                      class="more"
                      :aria-expanded="openKey === e.entryKey"
                      :aria-controls="`hd-${e.entryKey.replace(':', '-')}`"
                      @click="toggle(e)"
                    >
                      {{ openKey === e.entryKey ? '상세 접기' : '상세 보기' }}
                    </button>
                  </template>
                </HistoryCard>
                <li v-if="openKey === e.entryKey" :id="`hd-${e.entryKey.replace(':', '-')}`" class="detail-row">
                  <HistoryEntryDetail
                    :building-id="buildingId"
                    :kind="e.entryKind"
                    :source-id="e.sourceId"
                    :building-name="building?.buildingName ?? rail?.buildingName"
                    :building-type-name="building?.buildingTypeName"
                  />
                </li>
              </template>
            </ul>
          </template>
        </section>

        <!-- ================================================= 반복 하자 -->
        <section v-else class="stack-lg" role="tabpanel" aria-label="반복 하자">
          <RetryBox v-if="repErr" :message="repErr" :busy="repLoading" @retry="loadRepeat" />
          <p v-else-if="repLoading && !repeat" class="skeleton" style="height: 160px" aria-label="반복 하자를 불러오는 중"></p>
          <template v-else-if="repeat?.blocked">
            <C2GateBlock :block="repeat.gate" @action="onG7Action" />
            <div class="follow">
              <C3ReasonedButton disabled gate="G7">이 패턴으로 점검 계획</C3ReasonedButton>
              <C3ReasonedButton disabled gate="G7" variant="secondary">이 패턴으로 전문가 연결</C3ReasonedButton>
            </div>
          </template>
          <template v-else-if="repeat">
            <p class="caption">
              같은 위치·같은 하자 종류로 2회 이상 발생한 패턴입니다 · 판단 이력 {{ repeat.historyCount }}건 (기준 {{ repeat.minRequired }}건
              이상)
            </p>
            <p v-if="!repeat.patterns.length" class="empty">반복 하자 패턴이 없습니다</p>
            <ul v-else class="patterns">
              <li v-for="p in repeat.patterns" :key="`${p.locationText}|${p.defectTypeCode}`" class="pattern">
                <div class="pattern-head">
                  <div>
                    <p class="title-md">{{ p.locationText }}</p>
                    <p class="body-sm muted">{{ p.defectTypeName }}</p>
                  </div>
                  <p class="count">
                    <b>{{ p.occurrenceCount }}</b
                    ><span class="caption">회 발생</span>
                  </p>
                </div>
                <div>
                  <p class="label-upper muted">근거 이력</p>
                  <ol class="basis">
                    <li v-for="b in p.basis" :key="b.kind + b.id">
                      <span class="caption mono">{{ fmtDate(b.occurredAt) }}</span>
                      <StatusBadge tone="na" :label="b.kind === 'external' ? '외부' : '내부'" />
                      <span class="body-sm">{{ b.summary }}</span>
                    </li>
                  </ol>
                </div>
                <div class="follow">
                  <BaseButton v-if="canSchedule" :to="scheduleTo(p)">정기점검 계획</BaseButton>
                  <C3ReasonedButton v-else disabled reason="정기점검 일정 관리 권한이 없습니다">정기점검 계획</C3ReasonedButton>
                  <BaseButton v-if="!expertReason(p)" variant="secondary" :to="expertTo(p)">전문가 연결</BaseButton>
                  <C3ReasonedButton v-else disabled variant="secondary" :reason="expertReason(p)">전문가 연결</C3ReasonedButton>
                </div>
              </li>
            </ul>
          </template>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.picker {
  min-width: 280px;
}
.source-row {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  margin-bottom: var(--s-md);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-md) var(--s-xl);
  margin-top: var(--s-md);
}
.filter {
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
  min-width: 0;
  max-width: 100%;
}
.timeline {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-flow: row dense;
  gap: var(--s-md);
}
.timeline > .is-open {
  border-color: var(--ink);
}
.detail-row {
  grid-column: 1 / -1;
  min-width: 0;
}
.more {
  min-height: var(--touch);
  padding: 0 var(--s-sm);
  background: none;
  border: 1px solid var(--hairline-strong);
  font: var(--t-button);
  color: var(--ink);
  cursor: pointer;
}
.more:hover {
  border-color: var(--ink);
}
.more:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.patterns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-md);
}
.pattern {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  border: 1px solid var(--hairline);
  padding: var(--s-lg);
  min-width: 0;
}
.pattern-head {
  display: flex;
  justify-content: space-between;
  gap: var(--s-md);
  align-items: flex-start;
}
.count {
  display: flex;
  align-items: baseline;
  gap: var(--s-xxs);
  flex: none;
}
.count b {
  font: var(--t-display-sm);
  color: var(--ink);
}
.basis {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--hairline);
  margin-top: var(--s-xs);
}
.basis li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-xs);
  padding: var(--s-xs) 0;
  border-bottom: 1px solid var(--hairline);
}
.follow {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
  align-items: flex-start;
}
@media (max-width: 1023px) {
  .timeline {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .patterns {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 767px) {
  .timeline {
    grid-template-columns: minmax(0, 1fr);
  }
  .picker {
    min-width: 0;
    width: 100%;
  }
  .pattern {
    padding: var(--s-md);
  }
}
</style>
