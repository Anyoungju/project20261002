<script setup lang="ts">
/**
 * S6 유지관리 우선순위 (UC8 · P6 · SD_02 §9) — 기업 관리자. 게이트는 G0(권한·라이선스 만료) 뿐.
 * 산출 결과는 스냅숏(FR-065) — 다시 열어도 같은 결과. 고지(C4 priority)는 목록 위, 닫기 없음(FR-062).
 * 부분 데이터는 C7 로 알리고 막지 않는다(FR-063).
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get, api, patch, errorMessage, newIdempotencyKey, GateBlockError, type GateBlock } from '@/api/client';
import { useSession } from '@/stores/session';
import { fmtDate } from '@/composables/useCan';
import C3ReasonedButton from '@/components/common/C3ReasonedButton.vue';
import C4ReferenceNotice from '@/components/common/C4ReferenceNotice.vue';
import C7SourceStatusBar from '@/components/common/C7SourceStatusBar.vue';
import C8BuildingPicker from '@/components/common/C8BuildingPicker.vue';
import G0Block from '@/components/common/G0Block.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import FilterChips from '@/components/base/FilterChips.vue';
import SpecCell from '@/components/base/SpecCell.vue';
import RetryBox from '@/components/base/RetryBox.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();

// ---------------------------------------------------------------- 대시보드
const dash = ref<any | null>(null);
const dashErr = ref('');
const dashLoading = ref(false);
const g0 = ref<GateBlock | null>(null);

async function loadDashboard() {
  dashLoading.value = true;
  dashErr.value = '';
  try {
    dash.value = await get('/api/org/dashboard');
    g0.value = null;
  } catch (e) {
    if (e instanceof GateBlockError) g0.value = e.block;
    else dashErr.value = errorMessage(e);
  } finally {
    dashLoading.value = false;
  }
}

const nextDueText = computed(() => {
  const n = dash.value?.summary.daysToNextDue;
  if (n == null) return '-';
  if (n === 0) return 'D-DAY';
  return n > 0 ? `D-${n}` : `D+${-n}`;
});
const matchRate = computed(() => (dash.value?.summary.expertMatchRate == null ? '-' : `${dash.value.summary.expertMatchRate}%`));

// ---------------------------------------------------------------- 범위·기간
const scope = ref<'all' | 'pick'>('all');
const picked = ref<number[]>([]);
const period = ref('90');
const SCOPES = [
  { value: 'all', label: '관리 건물 전체' },
  { value: 'pick', label: '건물 선택' },
];
const PERIODS = [
  { value: '90', label: '최근 90일' },
  { value: '180', label: '최근 180일' },
  { value: '365', label: '최근 1년' },
];
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const scopeIds = computed<number[]>(() =>
  scope.value === 'all' ? (dash.value?.buildings ?? []).map((b: any) => b.buildingId) : picked.value,
);
const runReason = computed(() => {
  if (!session.can('priority.run')) return '우선순위 산출 권한이 없습니다';
  if (!scopeIds.value.length) return scope.value === 'pick' ? '건물을 1개 이상 선택하세요' : '관리 건물이 없습니다';
  return null;
});

// ---------------------------------------------------------------- 산출 · 스냅숏
const run = ref<any | null>(null);
const runLoading = ref(false);
const runErr = ref('');
const runBusy = ref(false);
let idemKey = newIdempotencyKey();
let lastAction: (() => Promise<void>) | null = null;

async function createRun() {
  if (runReason.value || runBusy.value) return;
  runBusy.value = true;
  runErr.value = '';
  lastAction = createRun;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - Number(period.value));
  try {
    const r = await api('/api/priority-runs', {
      method: 'POST',
      body: { buildingIds: scopeIds.value, periodFrom: ymd(from), periodTo: ymd(to) },
      idempotencyKey: idemKey,
    });
    idemKey = newIdempotencyKey();
    run.value = r;
    if (dash.value) {
      dash.value.runs = [
        {
          runId: r.runId,
          periodFrom: r.periodFrom,
          periodTo: r.periodTo,
          externalIncluded: r.externalIncluded,
          excludedBuildingCount: r.excludedBuildingCount,
          createdAt: r.createdAt,
        },
        ...dash.value.runs.filter((x: any) => x.runId !== r.runId),
      ];
    }
    router.replace({ query: { ...route.query, runId: String(r.runId) } });
  } catch (e) {
    idemKey = newIdempotencyKey();
    if (e instanceof GateBlockError && e.block.gate === 'G0') g0.value = e.block;
    else runErr.value = errorMessage(e);
  } finally {
    runBusy.value = false;
  }
}
async function openRun(id: number) {
  if (run.value?.runId === id) return;
  runLoading.value = true;
  runErr.value = '';
  lastAction = () => openRun(id);
  try {
    run.value = await get(`/api/priority-runs/${id}`);
  } catch (e) {
    if (e instanceof GateBlockError && e.block.gate === 'G0') g0.value = e.block;
    else runErr.value = errorMessage(e);
  } finally {
    runLoading.value = false;
  }
}
function selectRun(id: number) {
  router.replace({ query: { ...route.query, runId: String(id) } });
}
watch(
  () => route.query.runId,
  (v) => {
    if (v && Number(v)) openRun(Number(v));
  },
);

// ---------------------------------------------------------------- 표시
const lowCount = computed(() => (run.value?.items ?? []).filter((i: any) => i.confidence === 'low').length);
const c7Items = computed(() => {
  const r = run.value;
  if (!r) return [];
  const out: Array<{ key: string; label: string; detail?: string | null }> = [];
  if (r.excludedBuildingCount > 0)
    out.push({
      key: 'excluded',
      label: `권한 밖 건물 ${r.excludedBuildingCount}개 제외`,
      detail: '선택 범위 중 조회 권한이 없는 건물은 집계에서 뺐습니다. 권한 밖이라 건물명은 표시하지 않습니다.',
    });
  if (!r.externalIncluded) {
    const failed = (dash.value?.buildings ?? []).filter((b: any) => b.source?.externalMissing).map((b: any) => b.buildingName);
    out.push({
      key: 'external',
      label: '외부 미반영',
      detail: `건물관리시스템 연동이 실패했거나 아직 동기화되지 않은 건물이 있어 내부 이력과 이미 받은 외부 이력으로만 집계했습니다${failed.length ? ` (${failed.join(', ')})` : ''}.`,
    });
  }
  if (lowCount.value > 0)
    out.push({
      key: 'low',
      label: `신뢰도 낮음 ${lowCount.value}건`,
      detail: '이력이 기준보다 적은 항목입니다. 순위는 보이지만 참고 한계가 있습니다.',
    });
  return out;
});
/** 반복 하자 현황 — 스냅숏 항목에서 근거 2건 이상인 묶음을 하자 종류별로 */
const repeatSummary = computed(() => {
  const m = new Map<string, { name: string; buildings: Set<number>; count: number }>();
  for (const i of run.value?.items ?? []) {
    if ((i.basis?.length ?? 0) < 2) continue;
    const g = m.get(i.defectTypeCode) ?? { name: i.defectTypeName, buildings: new Set<number>(), count: 0 };
    g.buildings.add(i.buildingId);
    g.count += i.basis.length;
    m.set(i.defectTypeCode, g);
  }
  return [...m.values()].map((g) => ({ name: g.name, buildingCount: g.buildings.size, count: g.count })).sort((a, b) => b.count - a.count);
});

// ---------------------------------------------------------------- 조치 지정
const closed = ref<Record<string, boolean>>({});
const closeKey = (rank: number) => `${run.value?.runId}:${rank}`;
const confirmRank = ref<number | null>(null);
const actBusy = ref<string | null>(null);
const actErr = ref<Record<number, string>>({});
const actNote = ref<Record<number, string>>({});
const openRank = ref<number | null>(null);

function actionBadge(i: any): { tone: 'info' | 'na' | 'ok'; label: string } {
  if (closed.value[closeKey(i.rank)]) return { tone: 'na', label: '조치 없음 종료' };
  if (i.assignedAction === 'inspection') return { tone: 'info', label: '정기점검 지정' };
  if (i.assignedAction === 'expert') return { tone: 'info', label: '전문가 연결 지정' };
  return { tone: 'na', label: '조치 미지정' };
}
function expertReason(i: any) {
  if (!i.latestCaseId) return '외부 이력만 근거인 항목이라 연결할 하자 건이 없습니다';
  return null;
}
async function assign(i: any, action: 'inspection' | 'expert' | null) {
  if (!run.value || actBusy.value) return;
  const runId = run.value.runId;
  actBusy.value = `${i.rank}:${action ?? 'none'}`;
  actErr.value = { ...actErr.value, [i.rank]: '' };
  actNote.value = { ...actNote.value, [i.rank]: '' };
  try {
    const r = await patch(`/api/priority-runs/${runId}/items/${i.rank}`, { action });
    run.value = r;
    if (action === null) {
      closed.value = { ...closed.value, [`${runId}:${i.rank}`]: true };
      confirmRank.value = null;
      return;
    }
    delete closed.value[`${runId}:${i.rank}`];
    if (action === 'inspection') {
      if (session.can('schedule.manage')) {
        router.push({
          path: '/schedules',
          query: {
            buildingId: String(i.buildingId),
            item: `${i.locationText ?? ''} ${i.defectTypeName} 반복 점검`.trim(),
            location: i.locationText ?? undefined,
            defectType: i.defectTypeCode,
          },
        });
      } else
        actNote.value = { ...actNote.value, [i.rank]: '정기점검 조치를 지정했습니다. 일정 생성은 건물관리자의 정기점검 화면에서 합니다.' };
    } else if (action === 'expert') {
      if (session.can('expert_request.create')) {
        router.push({ path: '/expert-requests/new', query: { caseId: String(i.latestCaseId), origin: 'priority' } });
      } else
        actNote.value = {
          ...actNote.value,
          [i.rank]: '전문가 연결 조치를 지정했습니다. 요청 작성은 건물관리자의 전문가 점검 요청 화면에서 합니다.',
        };
    }
  } catch (e) {
    actErr.value = { ...actErr.value, [i.rank]: errorMessage(e) };
  } finally {
    actBusy.value = null;
  }
}

onMounted(async () => {
  await loadDashboard();
  if (!g0.value && route.query.runId && Number(route.query.runId)) openRun(Number(route.query.runId));
});
</script>

<template>
  <div>
    <nav v-if="dash" class="scope-rail" aria-label="집계 범위">
      <div class="container rail-inner">
        <strong>{{ dash.org.orgName }}</strong>
        <span
          ><span class="sep" aria-hidden="true">|</span> 관리 건물 <b>{{ dash.buildings.length }}</b
          >개</span
        >
        <template v-if="run">
          <span><span class="sep" aria-hidden="true">|</span> 산출 #{{ run.runId }}</span>
          <span><span class="sep" aria-hidden="true">|</span> 기간 {{ fmtDate(run.periodFrom) }} ~ {{ fmtDate(run.periodTo) }}</span>
          <span :class="{ alert: run.excludedBuildingCount > 0 }"
            ><span class="sep" aria-hidden="true">|</span> 제외 권한 밖 <b>{{ run.excludedBuildingCount }}</b
            >개</span
          >
        </template>
      </div>
    </nav>
    <div class="container page">
      <div class="page-head">
        <div>
          <p class="eyebrow">기업 관리</p>
          <h1 class="display-md">유지관리 우선순위</h1>
          <p class="body-md muted" style="margin-top: 8px">
            관리 건물의 이력과 반복 하자를 근거로 먼저 볼 곳을 정리합니다. 결과는 산출 시점 그대로 보존됩니다.
          </p>
        </div>
        <p v-if="dash?.org.licenseExpiresOn" class="caption">기업 라이선스 {{ fmtDate(dash.org.licenseExpiresOn) }}까지</p>
      </div>

      <G0Block v-if="g0" screen="S6" :block="g0" />
      <RetryBox v-else-if="dashErr" :message="dashErr" :busy="dashLoading" @retry="loadDashboard" />
      <div v-else-if="!dash" class="grid-4">
        <p v-for="i in 4" :key="i" class="skeleton" style="height: 96px"></p>
      </div>

      <template v-else>
        <!-- ============================================ 요약 -->
        <section class="grid-4 specs" aria-label="관리 요약">
          <SpecCell :value="dash.summary.analysisCount" label="누적 분석" />
          <SpecCell :value="dash.summary.actionNeeded" label="조치 필요" :tone="dash.summary.actionNeeded > 0 ? 'alert' : 'default'" />
          <SpecCell
            :value="nextDueText"
            :label="dash.summary.nextDue ? `다음 정기점검 ${fmtDate(dash.summary.nextDue)}` : '다음 정기점검'"
          />
          <SpecCell :value="matchRate" label="전문가 일치율" />
        </section>

        <section class="stack" aria-labelledby="s6-bld">
          <h2 id="s6-bld" class="title-lg">관리 건물</h2>
          <p v-if="!dash.buildings.length" class="empty">관리 건물이 없습니다</p>
          <ul v-else class="grid-3">
            <li v-for="b in dash.buildings" :key="b.buildingId" class="bcard">
              <div>
                <p class="title-md">{{ b.buildingName }}</p>
                <p class="caption">{{ b.buildingTypeName }}</p>
              </div>
              <div class="row">
                <StatusBadge v-if="b.overdueCount > 0" tone="danger" :label="`지연 ${b.overdueCount}`" />
                <StatusBadge v-if="b.openNotices > 0" tone="warn" :label="`위험 통지 ${b.openNotices}`" />
                <StatusBadge v-if="b.source?.externalMissing" tone="warn" label="외부 미반영" />
                <StatusBadge v-if="!b.overdueCount && !b.openNotices && !b.source?.externalMissing" tone="ok" label="특이 없음" />
              </div>
              <dl class="dl">
                <dt>이력</dt>
                <dd>{{ b.historyCount }}건</dd>
                <dt>보수 미완료</dt>
                <dd>{{ b.pendingRepairs }}건</dd>
                <dt>연결 대기</dt>
                <dd>{{ b.awaitingCount }}건</dd>
                <dt>다음 점검</dt>
                <dd>{{ b.nextDue ? fmtDate(b.nextDue) : '-' }}</dd>
              </dl>
              <BaseButton
                v-if="session.can('building.history.read')"
                variant="text"
                size="sm"
                :to="{ path: '/buildings/history', query: { buildingId: String(b.buildingId) } }"
                >건물 이력</BaseButton
              >
            </li>
          </ul>
        </section>

        <!-- ============================================ 산출 -->
        <section class="panel-soft stack run-form" aria-labelledby="s6-run">
          <h2 id="s6-run" class="title-lg">우선순위 산출</h2>
          <div class="field">
            <span class="field-label">건물 범위</span>
            <FilterChips v-model="scope" :options="SCOPES" label="건물 범위" />
          </div>
          <C8BuildingPicker
            v-if="scope === 'pick'"
            :model-value="null"
            multiple
            :selected="picked"
            screen="S6"
            label="산출할 건물"
            @update:selected="picked = $event"
          />
          <div class="field">
            <span class="field-label">기간</span>
            <FilterChips v-model="period" :options="PERIODS" label="기간" />
          </div>
          <div class="row">
            <C3ReasonedButton :busy="runBusy" :disabled="!!runReason" :reason="runReason" @click="createRun"
              >우선순위 산출</C3ReasonedButton
            >
            <span class="caption">{{ scopeIds.length }}개 건물 · 권한 밖 건물은 자동 제외됩니다</span>
          </div>
        </section>

        <section v-if="dash.runs.length" class="stack" aria-labelledby="s6-runs">
          <h2 id="s6-runs" class="title-md">지난 산출</h2>
          <ul class="runs">
            <li v-for="r in dash.runs" :key="r.runId">
              <button type="button" class="run-btn" :aria-current="run?.runId === r.runId ? 'true' : undefined" @click="selectRun(r.runId)">
                <b>#{{ r.runId }}</b>
                <span>{{ fmtDate(r.periodFrom) }} ~ {{ fmtDate(r.periodTo) }}</span>
                <span class="caption"
                  >{{ fmtDate(r.createdAt, true) }} 산출<template v-if="r.excludedBuildingCount">
                    · 제외 {{ r.excludedBuildingCount }}</template
                  ><template v-if="!r.externalIncluded"> · 외부 미반영</template></span
                >
              </button>
            </li>
          </ul>
        </section>

        <RetryBox v-if="runErr" :message="runErr" :busy="runBusy || runLoading" @retry="lastAction && lastAction()" />
        <p v-else-if="runLoading" class="skeleton" style="height: 200px" aria-label="산출 결과를 불러오는 중"></p>

        <!-- ============================================ 결과(스냅숏) -->
        <section v-if="run && !runLoading" class="stack-lg result" aria-labelledby="s6-result" aria-live="polite">
          <div class="row-between">
            <h2 id="s6-result" class="title-lg">우선순위 #{{ run.runId }}</h2>
            <p class="caption">
              {{ fmtDate(run.periodFrom) }} ~ {{ fmtDate(run.periodTo) }} · {{ fmtDate(run.createdAt, true) }} 산출 · 스냅숏
            </p>
          </div>
          <!-- FR-062: 고지는 순위 목록 위, 닫기 없음 -->
          <C4ReferenceNotice :notice="run.notice" variant="priority" />
          <C7SourceStatusBar :items="c7Items" />

          <div v-if="repeatSummary.length" class="stack">
            <h3 class="title-md">반복 하자 현황</h3>
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col">하자 종류</th>
                    <th scope="col">반복 건물 수</th>
                    <th scope="col">재발 건수</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="g in repeatSummary" :key="g.name">
                    <td>{{ g.name }}</td>
                    <td>{{ g.buildingCount }}</td>
                    <td>{{ g.count }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <h3 class="title-md">우선순위</h3>
          <p v-if="!run.items.length" class="empty">기간 안에 근거 이력이 없어 산출된 항목이 없습니다</p>
          <ol v-else class="items">
            <li v-for="i in run.items" :key="i.rank" class="item" :class="{ closed: closed[closeKey(i.rank)] }">
              <div class="item-main">
                <span class="rank" aria-label="순위">{{ i.rank }}</span>
                <div class="item-body">
                  <p class="title-md">{{ i.buildingName }} · {{ i.locationText ?? '위치 미상' }}</p>
                  <div class="row">
                    <span class="body-sm">{{ i.defectTypeName }}</span>
                    <StatusBadge v-if="i.confidence === 'low'" tone="warn" label="신뢰도 낮음" />
                    <StatusBadge v-else tone="ok" label="신뢰도 보통" />
                    <StatusBadge :tone="actionBadge(i).tone" :label="actionBadge(i).label" />
                    <span class="caption">근거 {{ i.basis.length }}건</span>
                  </div>
                  <p v-if="i.confidence === 'low'" class="caption">이력 부족 - 참고 한계</p>
                </div>
              </div>

              <div class="item-actions">
                <button
                  type="button"
                  class="more"
                  :aria-expanded="openRank === i.rank"
                  :aria-controls="`s6-b-${i.rank}`"
                  @click="openRank = openRank === i.rank ? null : i.rank"
                >
                  {{ openRank === i.rank ? '근거 접기' : '근거 보기' }}
                </button>
                <template v-if="session.can('priority.run') && confirmRank !== i.rank">
                  <BaseButton size="sm" :busy="actBusy === `${i.rank}:inspection`" :disabled="!!actBusy" @click="assign(i, 'inspection')"
                    >정기점검</BaseButton
                  >
                  <BaseButton
                    v-if="!expertReason(i)"
                    variant="secondary"
                    size="sm"
                    :busy="actBusy === `${i.rank}:expert`"
                    :disabled="!!actBusy"
                    @click="assign(i, 'expert')"
                    >전문가 연결</BaseButton
                  >
                  <C3ReasonedButton v-else disabled variant="secondary" :reason="expertReason(i)">전문가 연결</C3ReasonedButton>
                  <BaseButton v-if="!closed[closeKey(i.rank)]" variant="ghost" size="sm" @click="confirmRank = i.rank"
                    >조치 없음 종료</BaseButton
                  >
                </template>
              </div>

              <div v-if="confirmRank === i.rank" class="confirm" role="group" :aria-label="`${i.rank}순위 조치 없음 종료 확인`">
                <p class="body-sm">
                  이 항목을 조치 없이 종료할까요? 지정된 조치가 있으면 해제됩니다. 산출 결과(순위·근거)는 바뀌지 않습니다.
                </p>
                <div class="row">
                  <BaseButton size="sm" :busy="actBusy === `${i.rank}:none`" @click="assign(i, null)">조치 없음 종료</BaseButton>
                  <BaseButton variant="secondary" size="sm" @click="confirmRank = null">돌아가기</BaseButton>
                </div>
              </div>
              <p v-if="actNote[i.rank]" class="body-sm" role="status">{{ actNote[i.rank] }}</p>
              <p v-if="actErr[i.rank]" class="err" role="alert">
                {{ actErr[i.rank] }} <button type="button" class="link-retry" @click="actErr[i.rank] = ''">닫기</button>
              </p>

              <div v-if="openRank === i.rank" :id="`s6-b-${i.rank}`" class="basis">
                <p class="label-upper muted">근거 이력</p>
                <ul>
                  <li v-for="b in i.basis" :key="b.kind + b.id">
                    <span class="caption mono">{{ fmtDate(b.occurredAt) }}</span>
                    <StatusBadge tone="na" :label="b.kind === 'external' ? '외부' : '내부'" />
                    <span class="body-sm">{{ b.summary }}</span>
                    <RouterLink
                      v-if="b.kind === 'field_record' && session.can('building.history.read')"
                      :to="{ path: '/buildings/history', query: { buildingId: String(i.buildingId) } }"
                      class="body-sm"
                    >
                      하자 건 {{ b.caseNo }} 이력 보기
                    </RouterLink>
                  </li>
                </ul>
              </div>
            </li>
          </ol>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.scope-rail {
  background: var(--surface-dark);
  color: var(--on-dark);
  font: var(--t-body-sm);
}
.rail-inner {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xxs) var(--s-sm);
  align-items: center;
  min-height: var(--touch);
  padding-top: var(--s-xs);
  padding-bottom: var(--s-xs);
}
.scope-rail .sep {
  color: var(--on-dark-soft);
  margin-right: var(--s-xxs);
}
.scope-rail .alert b {
  color: var(--warning);
}
.specs {
  margin-bottom: var(--s-xl);
}
.bcard {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  border: 1px solid var(--hairline);
  padding: var(--s-md);
  min-width: 0;
}
.run-form {
  margin: var(--s-xl) 0;
}
.runs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
}
.run-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: var(--touch);
  padding: var(--s-xs) var(--s-sm);
  background: var(--canvas);
  border: 1px solid var(--hairline-strong);
  font: var(--t-body-sm);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
}
.run-btn[aria-current='true'] {
  border: 2px solid var(--primary);
  padding: calc(var(--s-xs) - 1px) calc(var(--s-sm) - 1px);
}
.run-btn:focus-visible,
.more:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.result {
  margin-top: var(--s-xl);
}
.items {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--hairline-strong);
}
.item {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  padding: var(--s-md) 0;
  border-bottom: 1px solid var(--hairline);
}
.item.closed .item-body {
  color: var(--muted);
}
.item-main {
  display: flex;
  gap: var(--s-md);
  align-items: flex-start;
  min-width: 0;
}
.item-body {
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
  min-width: 0;
}
.rank {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: var(--ink);
  color: var(--on-dark);
  font: var(--t-title-sm);
}
.item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
  align-items: flex-start;
  padding-left: calc(40px + var(--s-md));
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
.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  border: 1px solid var(--hairline-strong);
  background: var(--surface-soft);
  padding: var(--s-md);
  margin-left: calc(40px + var(--s-md));
}
.err {
  font: var(--t-body-sm);
  color: var(--error-text);
  margin-left: calc(40px + var(--s-md));
}
.link-retry {
  background: none;
  border: 0;
  padding: 0;
  min-height: 32px;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
  color: inherit;
}
.basis {
  margin-left: calc(40px + var(--s-md));
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.basis li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-xs);
  padding: var(--s-xs) 0;
  border-bottom: 1px solid var(--hairline);
}
@media (max-width: 767px) {
  .item-actions,
  .confirm,
  .err,
  .basis {
    padding-left: 0;
    margin-left: 0;
  }
}
</style>
