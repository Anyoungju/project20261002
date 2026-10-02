<script setup lang="ts">
/**
 * S7A 정기점검 일정 (UC6 · P7 · SD_02 §10) — 건물관리자.
 * 상태는 v_schedule_status.display_status 만 표시(재계산 금지). 지연은 맨 위.
 * 생성(배정 통지) · 수정 · 취소(인라인 확인, 모달 없음). 완료는 현장 기록 연결로만(FR-073) — 이 화면엔 결과 입력란 없음.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get, post, patch, errorMessage, GateBlockError, NetworkError, type GateBlock } from '@/api/client';
import { useReference } from '@/stores/reference';
import { loadDraft, saveDraft, clearDraft } from '@/stores/drafts';
import { fmtDate } from '@/composables/useCan';
import C1ProgressRail from '@/components/common/C1ProgressRail.vue';
import C3ReasonedButton from '@/components/common/C3ReasonedButton.vue';
import C5RiskRecommendation from '@/components/common/C5RiskRecommendation.vue';
import C8BuildingPicker from '@/components/common/C8BuildingPicker.vue';
import G0Block from '@/components/common/G0Block.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import RetryBox from '@/components/base/RetryBox.vue';
import ScheduleForm, { type ScheduleValues } from '@/components/schedule/ScheduleForm.vue';

type Tone = 'ok' | 'warn' | 'danger' | 'ref' | 'na' | 'info';
const STATUS: Record<string, { tone: Tone; label: string }> = {
  scheduled: { tone: 'info', label: '예정' },
  due: { tone: 'warn', label: '도래' },
  overdue: { tone: 'danger', label: '지연' },
  completed: { tone: 'ok', label: '완료' },
  cancelled: { tone: 'na', label: '취소' },
};
const ORDER = ['overdue', 'due', 'scheduled', 'completed', 'cancelled'];

const route = useRoute();
const router = useRouter();
const reference = useReference();

const buildingId = computed<number | null>(() => (route.query.buildingId ? Number(route.query.buildingId) || null : null));
const qItem = computed(() => (typeof route.query.item === 'string' ? route.query.item : ''));
const qLocation = computed(() => (typeof route.query.location === 'string' ? route.query.location : ''));
const qDefect = computed(() => (typeof route.query.defectType === 'string' ? route.query.defectType : ''));

function onPick(id: number | null) {
  const q: Record<string, any> = { ...route.query };
  if (id) q.buildingId = String(id);
  else delete q.buildingId;
  router.replace({ query: q });
}

// ---------------------------------------------------------------- 데이터
const data = ref<{ rail: any; schedules: any[]; assignees: any[] } | null>(null);
const loading = ref(false);
const loadErr = ref('');
const accessBlock = ref<GateBlock | null>(null);

async function load() {
  const id = buildingId.value;
  if (!id) return;
  loading.value = true;
  loadErr.value = '';
  try {
    const r = await get(`/api/buildings/${id}/schedules`);
    if (id !== buildingId.value) return;
    data.value = r;
    accessBlock.value = null;
  } catch (e) {
    if (e instanceof GateBlockError) accessBlock.value = e.block;
    else loadErr.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
const schedules = computed(() =>
  [...(data.value?.schedules ?? [])].sort(
    (a, b) => ORDER.indexOf(a.displayStatus) - ORDER.indexOf(b.displayStatus) || String(a.dueDate).localeCompare(String(b.dueDate)),
  ),
);
const assignees = computed(() => data.value?.assignees ?? []);
const railCounts = computed(() => {
  const r = data.value?.rail;
  return r
    ? [
        { label: '이력', value: r.historyCount },
        { label: '정기점검 지연', value: r.overdueCount, alert: true },
        { label: '전문가 연결 대기', value: r.awaitingCount, alert: true },
      ]
    : [];
});
const counts = computed(() => {
  const c: Record<string, number> = {};
  for (const s of schedules.value) c[s.displayStatus] = (c[s.displayStatus] ?? 0) + 1;
  return c;
});

// ---------------------------------------------------------------- 새 일정
const draftKey = computed(() => `S7A:new:${buildingId.value ?? 0}`);
const blank = (): ScheduleValues => ({ itemText: '', cycleCode: null, dueDate: '', assigneeId: null });
const createOpen = ref(false);
const createVals = ref<ScheduleValues>(blank());
const createBusy = ref(false);
const createErr = ref('');
const createNet = ref('');
const createdMsg = ref('');

function initCreate() {
  const d = loadDraft<ScheduleValues>(draftKey.value);
  createVals.value = { ...blank(), ...(d ?? {}) };
  if (qItem.value) {
    createVals.value.itemText = qItem.value;
    createOpen.value = true;
  }
}
watch(createVals, (v) => createOpen.value && saveDraft(draftKey.value, v), { deep: true });

async function submitCreate() {
  if (!buildingId.value || createBusy.value) return;
  createBusy.value = true;
  createErr.value = '';
  createNet.value = '';
  createdMsg.value = '';
  try {
    const v = createVals.value;
    const r = await post<{ scheduleId: number; schedules: any[] }>(`/api/buildings/${buildingId.value}/schedules`, {
      itemText: v.itemText.trim(),
      cycleCode: v.cycleCode || null,
      dueDate: v.dueDate,
      assigneeId: v.assigneeId,
    });
    if (data.value) data.value.schedules = r.schedules;
    const who = assignees.value.find((a: any) => a.userId === v.assigneeId)?.nameMasked ?? '담당자';
    createdMsg.value = `일정을 저장하고 ${who}에게 배정 통지를 보냈습니다`;
    clearDraft(draftKey.value);
    createVals.value = blank();
    createOpen.value = false;
    if (route.query.item || route.query.location || route.query.defectType) {
      const q: Record<string, any> = { ...route.query };
      delete q.item;
      delete q.location;
      delete q.defectType;
      router.replace({ query: q });
    }
    loadRail();
  } catch (e) {
    if (e instanceof NetworkError) createNet.value = errorMessage(e);
    else createErr.value = errorMessage(e);
  } finally {
    createBusy.value = false;
  }
}
async function loadRail() {
  if (!buildingId.value || !data.value) return;
  try {
    data.value.rail = await get(`/api/buildings/${buildingId.value}/rail`);
  } catch {
    /* 레일은 보조 정보 */
  }
}

// ---------------------------------------------------------------- 수정 · 취소 (인라인)
const editId = ref<number | null>(null);
const editVals = ref<ScheduleValues>(blank());
const editBusy = ref(false);
const editErr = ref('');
const cancelId = ref<number | null>(null);
const cancelBusy = ref(false);
const cancelErr = ref('');
const openId = ref<number | null>(null);

function startEdit(s: any) {
  cancelId.value = null;
  editErr.value = '';
  editId.value = s.scheduleId;
  openId.value = s.scheduleId;
  editVals.value = {
    itemText: s.itemText,
    cycleCode: s.cycleCode,
    dueDate: String(s.dueDate).slice(0, 10),
    assigneeId: s.assignee?.userId ?? null,
  };
}
async function submitEdit(s: any) {
  if (editBusy.value) return;
  editBusy.value = true;
  editErr.value = '';
  try {
    const v = editVals.value;
    const body: Record<string, unknown> = {};
    if (v.itemText.trim() !== s.itemText) body.itemText = v.itemText.trim();
    if ((v.cycleCode || null) !== (s.cycleCode || null)) body.cycleCode = v.cycleCode || null;
    if (v.dueDate !== String(s.dueDate).slice(0, 10)) body.dueDate = v.dueDate;
    if (v.assigneeId && v.assigneeId !== s.assignee?.userId) body.assigneeId = v.assigneeId;
    if (Object.keys(body).length) {
      const r = await patch<{ schedules: any[] }>(`/api/schedules/${s.scheduleId}`, body);
      if (data.value) data.value.schedules = r.schedules;
      loadRail();
    }
    editId.value = null;
  } catch (e) {
    editErr.value = errorMessage(e);
  } finally {
    editBusy.value = false;
  }
}
function askCancel(s: any) {
  editId.value = null;
  cancelErr.value = '';
  cancelId.value = s.scheduleId;
  openId.value = s.scheduleId;
}
async function confirmCancel(s: any) {
  if (cancelBusy.value) return;
  cancelBusy.value = true;
  cancelErr.value = '';
  try {
    const r = await post<{ schedules: any[] }>(`/api/schedules/${s.scheduleId}/cancel`);
    if (data.value) data.value.schedules = r.schedules;
    cancelId.value = null;
    loadRail();
  } catch (e) {
    cancelErr.value = errorMessage(e);
  } finally {
    cancelBusy.value = false;
  }
}
const editable = (s: any) => s.storedStatus === 'scheduled';
function toggleOpen(s: any) {
  openId.value = openId.value === s.scheduleId ? null : s.scheduleId;
  if (openId.value !== s.scheduleId) {
    editId.value = null;
    cancelId.value = null;
  }
}
function dueNote(s: any) {
  if (s.displayStatus === 'overdue') return `기한 ${fmtDate(s.dueDate)} 경과 - 연결된 현장 기록 없음`;
  if (s.displayStatus === 'due') return `기한 ${fmtDate(s.dueDate)} 도래 - 담당자에게 도래 알림 대상`;
  if (s.displayStatus === 'completed') return `현장 기록 #${s.completedRecordId} 연결로 완료`;
  if (s.displayStatus === 'cancelled') return `${fmtDate(s.cancelledAt, true)} 취소 - 감시 대상에서 제외`;
  return `기한 ${fmtDate(s.dueDate)}`;
}

// ---------------------------------------------------------------- 반응형 (표 ↔ 카드)
const isMobile = ref(false);
let mq: MediaQueryList | null = null;
const onMq = () => (isMobile.value = !!mq?.matches);

watch(buildingId, () => {
  data.value = null;
  accessBlock.value = null;
  editId.value = null;
  cancelId.value = null;
  openId.value = null;
  createdMsg.value = '';
  initCreate();
  load();
});
onMounted(() => {
  reference.load().catch(() => undefined);
  mq = window.matchMedia('(max-width: 767px)');
  onMq();
  mq.addEventListener('change', onMq);
  initCreate();
  load();
});
onBeforeUnmount(() => mq?.removeEventListener('change', onMq));
</script>

<template>
  <div>
    <C1ProgressRail v-if="data?.rail" variant="building" :title="data.rail.buildingName" :counts="railCounts" />
    <div class="container page">
      <div class="page-head">
        <div>
          <p class="eyebrow">건물 관리</p>
          <h1 class="display-md">정기점검 일정</h1>
          <p class="body-md muted" style="margin-top: 8px">
            점검 항목·주기·기한·담당 시설관리자를 정하고 지연을 추적합니다. 완료는 담당자의 현장 기록이 연결될 때만 됩니다.
          </p>
        </div>
        <div class="picker">
          <C8BuildingPicker :model-value="buildingId" access="manage" screen="S7A" label="건물" @update:model-value="onPick" />
        </div>
      </div>

      <p v-if="!buildingId" class="empty">일정을 관리할 건물을 선택하세요</p>
      <G0Block v-else-if="accessBlock" screen="S7A" :building-id="buildingId" :block="accessBlock" />
      <RetryBox v-else-if="loadErr" :message="loadErr" :busy="loading" @retry="load" />
      <p v-else-if="!data" class="skeleton" style="height: 240px" aria-label="일정을 불러오는 중"></p>

      <template v-else>
        <!-- ============================================== 새 일정 -->
        <section class="create" aria-labelledby="s7a-new">
          <div class="row-between">
            <h2 id="s7a-new" class="title-lg">새 일정</h2>
            <BaseButton v-if="!createOpen" @click="createOpen = true">새 일정</BaseButton>
          </div>
          <p v-if="createdMsg" class="ok-line" role="status"><StatusBadge tone="ok" label="배정 통지" /> {{ createdMsg }}</p>
          <div v-if="createOpen" class="panel-soft stack">
            <p v-if="qLocation || qDefect" class="body-sm">
              <StatusBadge tone="info" label="반복 하자 근거" />
              {{ [qLocation, qDefect ? reference.defectName(qDefect) : ''].filter(Boolean).join(' · ') }} 패턴에서 넘어왔습니다
            </p>
            <RetryBox v-if="createNet" :message="createNet" keeps-input :busy="createBusy" @retry="submitCreate" />
            <ScheduleForm
              v-model="createVals"
              id-prefix="s7a-new"
              :assignees="assignees"
              submit-label="일정 저장 후 배정 통지"
              :busy="createBusy"
              :error="createErr"
              @submit="submitCreate"
              @cancel="createOpen = false"
            />
          </div>
        </section>

        <!-- ============================================== 일정 목록 -->
        <section class="list" aria-labelledby="s7a-list">
          <div class="row-between">
            <h2 id="s7a-list" class="title-lg">일정 {{ schedules.length }}건</h2>
            <p class="caption">
              <template v-for="k in ORDER" :key="k"
                ><template v-if="counts[k]">{{ STATUS[k].label }} {{ counts[k] }} · </template></template
              >지연이 맨 위
            </p>
          </div>
          <p v-if="!schedules.length" class="empty">등록된 정기점검 일정이 없습니다</p>

          <!-- 데스크톱·태블릿: 표 -->
          <div v-else-if="!isMobile" class="table-wrap">
            <table class="table">
              <caption class="sr-only">
                정기점검 일정 - 지연이 맨 위
              </caption>
              <thead>
                <tr>
                  <th scope="col">점검 항목</th>
                  <th scope="col">주기</th>
                  <th scope="col">담당</th>
                  <th scope="col">기한</th>
                  <th scope="col">상태</th>
                  <th scope="col"><span class="sr-only">관리</span></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="s in schedules" :key="s.scheduleId">
                  <tr :class="[`st-${s.displayStatus}`, { 'is-highlight': openId === s.scheduleId }]">
                    <td>
                      <b v-if="s.displayStatus === 'overdue'">{{ s.itemText }}</b
                      ><span v-else>{{ s.itemText }}</span>
                    </td>
                    <td>{{ s.cycleName ?? '주기 미정' }}</td>
                    <td>{{ s.assignee?.nameMasked ?? '-' }}</td>
                    <td class="nowrap">{{ fmtDate(s.dueDate) }}</td>
                    <td>
                      <StatusBadge
                        :tone="STATUS[s.displayStatus]?.tone ?? 'na'"
                        :label="STATUS[s.displayStatus]?.label ?? s.displayStatus"
                      />
                    </td>
                    <td class="nowrap">
                      <button
                        type="button"
                        class="more"
                        :aria-expanded="openId === s.scheduleId"
                        :aria-controls="`s7a-d-${s.scheduleId}`"
                        @click="toggleOpen(s)"
                      >
                        {{ openId === s.scheduleId ? '접기' : '자세히' }}
                      </button>
                    </td>
                  </tr>
                  <tr
                    v-if="openId === s.scheduleId || (s.riskFlag && s.displayStatus === 'completed')"
                    :id="`s7a-d-${s.scheduleId}`"
                    class="detail-tr"
                  >
                    <td colspan="6">
                      <div class="sdetail">
                        <template v-if="openId === s.scheduleId">
                          <p class="body-sm" :class="{ strong: s.displayStatus === 'overdue' }">{{ dueNote(s) }}</p>
                          <p class="body-sm muted">
                            담당 {{ s.assignee?.nameMasked ?? '-'
                            }}<template v-if="s.assignee?.phoneMasked"> · {{ s.assignee.phoneMasked }}</template>
                            <template v-if="s.displayStatus === 'overdue'">
                              · {{ s.overdueAlertSent ? '지연 알림 보냄' : '지연 알림 발송 대기' }}</template
                            >
                          </p>
                          <div v-if="editable(s) && editId !== s.scheduleId && cancelId !== s.scheduleId" class="row">
                            <C3ReasonedButton
                              disabled
                              reason="연결된 현장 기록이 있어야 완료할 수 있습니다 - 담당자가 현장 기록을 저장하면 완료됩니다"
                              variant="secondary"
                              >완료 처리</C3ReasonedButton
                            >
                            <BaseButton variant="secondary" size="sm" @click="startEdit(s)">일정 수정</BaseButton>
                            <BaseButton variant="secondary" size="sm" @click="askCancel(s)">일정 취소</BaseButton>
                          </div>
                          <ScheduleForm
                            v-if="editId === s.scheduleId"
                            v-model="editVals"
                            :id-prefix="`s7a-e${s.scheduleId}`"
                            :assignees="assignees"
                            submit-label="수정 저장"
                            cancel-label="수정 취소"
                            :busy="editBusy"
                            :error="editErr"
                            @submit="submitEdit(s)"
                            @cancel="editId = null"
                          />
                          <div v-if="cancelId === s.scheduleId" class="confirm" role="group" :aria-label="`${s.itemText} 일정 취소 확인`">
                            <p class="title-sm">이 일정을 취소할까요?</p>
                            <p class="body-sm">취소하면 감시 대상에서 즉시 빠지고 도래·지연 알림이 나가지 않습니다. 되돌릴 수 없습니다.</p>
                            <p v-if="cancelErr" class="err" role="alert">{{ cancelErr }}</p>
                            <div class="row">
                              <BaseButton size="sm" :busy="cancelBusy" @click="confirmCancel(s)">일정 취소 확정</BaseButton>
                              <BaseButton variant="secondary" size="sm" @click="cancelId = null">돌아가기</BaseButton>
                            </div>
                          </div>
                        </template>
                        <C5RiskRecommendation
                          v-if="s.riskFlag && s.displayStatus === 'completed'"
                          risk-level="danger"
                          source="inspection"
                          :has-building="true"
                          :case-id="s.completedCaseId"
                          :risk-notice-id="s.openRiskNoticeId"
                        />
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <!-- 모바일: 카드 -->
          <ul v-else class="cards">
            <li v-for="s in schedules" :key="s.scheduleId" class="scard" :class="`st-${s.displayStatus}`">
              <div class="row-between">
                <StatusBadge :tone="STATUS[s.displayStatus]?.tone ?? 'na'" :label="STATUS[s.displayStatus]?.label ?? s.displayStatus" />
                <span class="caption">{{ s.cycleName ?? '주기 미정' }}</span>
              </div>
              <p class="title-md">{{ s.itemText }}</p>
              <p class="body-sm" :class="{ strong: s.displayStatus === 'overdue' }">{{ dueNote(s) }}</p>
              <p class="body-sm muted">
                담당 {{ s.assignee?.nameMasked ?? '-' }}<template v-if="s.assignee?.phoneMasked"> · {{ s.assignee.phoneMasked }}</template>
                <template v-if="s.displayStatus === 'overdue'">
                  · {{ s.overdueAlertSent ? '지연 알림 보냄' : '지연 알림 발송 대기' }}</template
                >
              </p>
              <div v-if="editable(s) && editId !== s.scheduleId && cancelId !== s.scheduleId" class="row">
                <BaseButton variant="secondary" size="sm" @click="startEdit(s)">일정 수정</BaseButton>
                <BaseButton variant="secondary" size="sm" @click="askCancel(s)">일정 취소</BaseButton>
              </div>
              <ScheduleForm
                v-if="editId === s.scheduleId"
                v-model="editVals"
                :id-prefix="`s7a-m${s.scheduleId}`"
                :assignees="assignees"
                submit-label="수정 저장"
                cancel-label="수정 취소"
                :busy="editBusy"
                :error="editErr"
                @submit="submitEdit(s)"
                @cancel="editId = null"
              />
              <div v-if="cancelId === s.scheduleId" class="confirm" role="group" :aria-label="`${s.itemText} 일정 취소 확인`">
                <p class="title-sm">이 일정을 취소할까요?</p>
                <p class="body-sm">취소하면 감시 대상에서 즉시 빠지고 도래·지연 알림이 나가지 않습니다.</p>
                <p v-if="cancelErr" class="err" role="alert">{{ cancelErr }}</p>
                <div class="row">
                  <BaseButton size="sm" :busy="cancelBusy" @click="confirmCancel(s)">일정 취소 확정</BaseButton>
                  <BaseButton variant="secondary" size="sm" @click="cancelId = null">돌아가기</BaseButton>
                </div>
              </div>
              <C5RiskRecommendation
                v-if="s.riskFlag && s.displayStatus === 'completed'"
                risk-level="danger"
                source="inspection"
                :has-building="true"
                :case-id="s.completedCaseId"
                :risk-notice-id="s.openRiskNoticeId"
              />
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.picker {
  min-width: 280px;
}
.create,
.list {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  margin-bottom: var(--s-xl);
}
.ok-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
  align-items: center;
  font: var(--t-body-sm);
  color: var(--body);
}
.nowrap {
  white-space: nowrap;
}
.table tr.st-overdue td:first-child {
  border-left: 4px solid var(--warning);
}
.table tr.st-cancelled td {
  color: var(--muted);
}
.detail-tr td {
  background: var(--surface-soft);
}
.sdetail {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.strong {
  font-weight: 700;
  color: var(--ink);
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
.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  border: 1px solid var(--error);
  background: var(--error-tint);
  padding: var(--s-md);
}
.err {
  font: var(--t-body-sm);
  color: var(--error-text);
}
.cards {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.scard {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  border: 1px solid var(--hairline);
  padding: var(--s-md);
  min-width: 0;
}
.scard.st-overdue {
  border-left: 4px solid var(--warning);
}
.scard.st-cancelled {
  color: var(--muted);
}
@media (max-width: 767px) {
  .picker {
    min-width: 0;
    width: 100%;
  }
}
</style>
