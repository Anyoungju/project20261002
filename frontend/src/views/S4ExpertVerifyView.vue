<script setup lang="ts">
/**
 * S4 전문가 검증 (UC4 · P4 · SD_02 §7 · FR-040~046)
 * 목록(하자 종류·상태 필터) → 선택(?itemId=) → 비교(데스크톱 2열 · 모바일 탭) → 판정(일치·불일치 + 의견·차이 + 위험 큼).
 * [판정 불가]는 라디오가 아닌 별도 행동 → 사유 입력 → 추가 자료 요청(G6). G6 열린 동안 [검증 완료]는 C3 비활성.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, get, post, ApiError, GateBlockError, newIdempotencyKey, errorMessage, type GateBlock } from '@/api/client';
import { useSession } from '@/stores/session';
import { useReference } from '@/stores/reference';
import { useGates } from '@/stores/gates';
import { loadDraft, saveDraft, clearDraft } from '@/stores/drafts';
import { fmtDate } from '@/composables/useCan';
import C1ProgressRail from '@/components/common/C1ProgressRail.vue';
import C2GateBlock from '@/components/common/C2GateBlock.vue';
import C3ReasonedButton from '@/components/common/C3ReasonedButton.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import PhotoThumb from '@/components/common/PhotoThumb.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import FilterChips from '@/components/base/FilterChips.vue';
import CategoryTabs from '@/components/base/CategoryTabs.vue';
import SpecCell from '@/components/base/SpecCell.vue';
import RetryBox from '@/components/base/RetryBox.vue';
import AlertBox from '@/components/base/AlertBox.vue';
import AiResultBrief from '@/components/record/AiResultBrief.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();
const ref_ = useReference();
const gates = useGates();

const defectType = ref('');
const status = ref('');
const items = ref<any[]>([]);
const listLoading = ref(true);
const listErr = ref('');
const detail = ref<any | null>(null);
const detailLoading = ref(false);
const detailErr = ref('');
const trust = ref<any | null>(null);

const itemId = computed(() => (route.query.itemId ? Number(route.query.itemId) : null));

const STATUS: Record<string, { tone: 'info' | 'warn' | 'ok'; label: string }> = {
  waiting: { tone: 'info', label: '검증 대기' },
  data_requested: { tone: 'warn', label: '자료 요청 중' },
  verified: { tone: 'ok', label: '검증 완료' },
};
const statusChips = [
  { value: '', label: '대기 전체' },
  { value: 'waiting', label: '검증 대기' },
  { value: 'data_requested', label: '자료 요청 중' },
  { value: 'verified', label: '검증 완료' },
];
const defectChips = computed(() => [
  { value: '', label: '하자 종류 전체' },
  ...ref_.defectTypes.map((d) => ({ value: d.code, label: d.name })),
]);

async function loadList() {
  listLoading.value = true;
  listErr.value = '';
  try {
    items.value = await get('/api/verification-items', { defectType: defectType.value, status: status.value });
  } catch (e) {
    listErr.value = errorMessage(e);
  } finally {
    listLoading.value = false;
  }
}
async function loadTrust() {
  if (!session.can(['trust_metric.read', 'org.dashboard.read'])) return;
  try {
    trust.value = await get('/api/trust-metrics');
  } catch {
    trust.value = null;
  }
}
async function loadDetail(id: number) {
  detailLoading.value = true;
  detailErr.value = '';
  try {
    detail.value = await get(`/api/verification-items/${id}`);
    restoreForm(id);
  } catch (e) {
    detail.value = null;
    detailErr.value = errorMessage(e);
  } finally {
    detailLoading.value = false;
  }
}

watch([defectType, status], loadList);
watch(itemId, (id) => {
  resetTransient();
  if (id) loadDetail(id);
  else detail.value = null;
});

function select(id: number) {
  router.replace({ query: { ...route.query, itemId: String(id) } });
  nextTick(() => document.getElementById('s4-detail')?.focus());
}

// ------------------------------------------------------------ 비교: 모바일 탭
const isMobile = ref(false);
let mq: MediaQueryList | null = null;
const onMq = () => (isMobile.value = !!mq?.matches);
const side = ref('ai');
const sideTabs = [
  { value: 'ai', label: '사용자 · AI' },
  { value: 'field', label: '현장 기록' },
];

// ------------------------------------------------------------ 판정
const form = ref<{ verdict: '' | 'match' | 'mismatch'; opinion: string; diffNote: string; riskHigh: boolean }>({
  verdict: '',
  opinion: '',
  diffNote: '',
  riskHigh: false,
});
const formErr = ref<{ verdict?: string; diffNote?: string }>({});
const gate = ref<GateBlock | null>(null);
const busy = ref(false);
const submitErr = ref('');
const savedMsg = ref('');
let idemKey = newIdempotencyKey();

const draftKey = () => (itemId.value ? `S4:${itemId.value}` : null);
function restoreForm(id: number) {
  const d = loadDraft<typeof form.value>(`S4:${id}`);
  form.value = d
    ? { ...{ verdict: '', opinion: '', diffNote: '', riskHigh: false }, ...d }
    : { verdict: '', opinion: '', diffNote: '', riskHigh: false };
}
watch(
  form,
  (v) => {
    const k = draftKey();
    if (k && detail.value) saveDraft(k, v);
  },
  { deep: true },
);
function resetTransient() {
  gate.value = null;
  formErr.value = {};
  submitErr.value = '';
  savedMsg.value = '';
  unable.value = false;
  unableReason.value = '';
  unableErr.value = '';
  reqSentMsg.value = '';
  side.value = 'ai';
  idemKey = newIdempotencyKey();
}

/** 서버가 준 G6(열린 자료 요청)이 우선. 판정 불가 사유 입력 중에도 [검증 완료]는 G6 사유로 비활성 */
const shownGate = computed<GateBlock | null>(() => detail.value?.gate ?? gate.value);
const openRequest = computed(() => (detail.value?.dataRequests ?? []).find((d: any) => d.open) ?? null);
const g6Active = computed(() => !!shownGate.value || unable.value);
/** 판정 불가를 누른 직후(요청 전) — 문구는 gate_def 단일 원천 */
const localG6 = computed<GateBlock>(() => ({
  gate: 'G6',
  message: gates.messageOf('G6'),
  releaseParty: gates.releasePartyOf('G6'),
  selfRelease: false,
  actions: [],
}));
const canJudge = computed(() => session.can('verification.judge'));
const canRequest = computed(() => session.can('verification.request_data'));
const verdictReason = computed(() => {
  if (!form.value.verdict) return '일치 또는 불일치를 선택해 주세요';
  if (form.value.verdict === 'mismatch' && !form.value.diffNote.trim()) return '불일치 판정에는 AI 와의 차이 내용을 적어 주세요';
  return null;
});

async function submitVerdict() {
  if (!detail.value || busy.value || g6Active.value) return;
  formErr.value = {};
  if (verdictReason.value) {
    if (!form.value.verdict) formErr.value.verdict = verdictReason.value;
    else formErr.value.diffNote = verdictReason.value;
    nextTick(() => document.getElementById(!form.value.verdict ? 's4-v-match' : 's4-diff')?.focus());
    return;
  }
  busy.value = true;
  submitErr.value = '';
  savedMsg.value = '';
  try {
    const d = await api(`/api/verification-items/${detail.value.itemId}/verdicts`, {
      method: 'POST',
      body: {
        verdict: form.value.verdict,
        opinion: form.value.opinion.trim() || null,
        diffNote: form.value.verdict === 'mismatch' ? form.value.diffNote.trim() : null,
        riskHigh: form.value.riskHigh,
      },
      idempotencyKey: idemKey,
    });
    detail.value = d;
    const cur = d.verdicts?.find((v: any) => v.current);
    savedMsg.value = `판정을 저장했습니다 - v${cur?.versionNo ?? ''} ${cur?.verdict === 'match' ? '일치' : '불일치'}${cur?.riskHigh ? ' · 위험 큼 통지를 보냈습니다' : ''}`;
    clearDraft(`S4:${d.itemId}`);
    form.value = { verdict: '', opinion: '', diffNote: '', riskHigh: false };
    idemKey = newIdempotencyKey();
    await Promise.all([loadList(), loadTrust()]);
  } catch (e) {
    idemKey = newIdempotencyKey();
    if (e instanceof GateBlockError) gate.value = e.block;
    else if (e instanceof ApiError && e.code === 'diff_required') {
      formErr.value.diffNote = e.message;
      nextTick(() => document.getElementById('s4-diff')?.focus());
    } else submitErr.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

// ------------------------------------------------------------ 판정 불가 → 추가 자료 요청
const unable = ref(false);
const unableReason = ref('');
const unableErr = ref('');
const unableBusy = ref(false);
const reqSentMsg = ref('');
function openUnable() {
  unable.value = true;
  nextTick(() => document.getElementById('s4-unable-reason')?.focus());
}
function cancelUnable() {
  unable.value = false;
  unableReason.value = '';
  unableErr.value = '';
}
async function sendDataRequest() {
  if (!detail.value || unableBusy.value) return;
  if (unableReason.value.trim().length < 2) {
    unableErr.value = '판정할 수 없는 사유를 2자 이상 적어 주세요';
    document.getElementById('s4-unable-reason')?.focus();
    return;
  }
  unableBusy.value = true;
  unableErr.value = '';
  try {
    detail.value = await post(`/api/verification-items/${detail.value.itemId}/data-requests`, { reason: unableReason.value.trim() });
    reqSentMsg.value = '추가 자료 요청을 보냈습니다 - 기록한 시설관리자에게 전달되었습니다';
    unable.value = false;
    unableReason.value = '';
    await Promise.all([loadList(), loadTrust()]);
  } catch (e) {
    unableErr.value = errorMessage(e);
  } finally {
    unableBusy.value = false;
  }
}

onMounted(async () => {
  mq = window.matchMedia('(max-width: 767px)');
  onMq();
  mq.addEventListener('change', onMq);
  ref_.load().catch(() => undefined);
  await Promise.all([loadList(), loadTrust()]);
  if (itemId.value) await loadDetail(itemId.value);
});
onBeforeUnmount(() => mq?.removeEventListener('change', onMq));

const rail = computed(() => detail.value?.progress ?? null);
const AI_MATCH: Record<string, string> = { match: '일치', mismatch: '불일치', none: '해당 없음' };
const trustType = computed(() =>
  defectType.value ? (trust.value?.byDefectType?.find((x: any) => x.defectTypeCode === defectType.value) ?? null) : null,
);
const trustView = computed(() => trustType.value ?? trust.value?.overall ?? null);
</script>

<template>
  <div>
    <C1ProgressRail v-if="rail" variant="case" :title="`하자 건 ${rail.caseNo}`" :stages="rail.stages" />
    <div class="container page">
      <div class="page-head">
        <div>
          <p class="eyebrow">전문가 업무</p>
          <h1 class="display-md">전문가 검증</h1>
          <p class="body-md muted" style="margin-top: 8px">AI 결과와 현장 판정이 다른 건을 나란히 보고 판정합니다.</p>
        </div>
      </div>

      <!-- 신뢰도 지표 (FR-045 — 판정 불가 제외) -->
      <section v-if="trust" class="trust" aria-label="AI 신뢰도 지표">
        <SpecCell
          :value="trustView?.matchRate == null ? '-' : `${trustView.matchRate}%`"
          :label="`AI 일치율${trustType ? ` · ${trustType.defectTypeName}` : ' · 전체'}`"
        />
        <SpecCell :value="trustView?.verdictCount ?? 0" label="판정 수" />
        <SpecCell :value="trustView?.mismatchCount ?? 0" label="불일치" />
        <SpecCell :value="`${trust.excludedUnableCount}건`" label="판정 불가 - 지표에서 제외" />
      </section>

      <!-- 목록 -->
      <section class="queue" aria-labelledby="s4-queue-title">
        <div class="row-between">
          <h2 id="s4-queue-title" class="title-lg">
            검증 목록 <span class="caption">{{ items.length }}건</span>
          </h2>
        </div>
        <div class="filters">
          <FilterChips v-model="defectType" :options="defectChips" label="하자 종류" />
          <FilterChips v-model="status" :options="statusChips" label="검증 상태" />
        </div>
        <RetryBox v-if="listErr" :message="listErr" :busy="listLoading" @retry="loadList" />
        <div v-if="listLoading && !items.length" class="qlist"><p v-for="i in 3" :key="i" class="skeleton" style="height: 72px"></p></div>
        <p v-else-if="!items.length" class="empty">조건에 맞는 검증 대상이 없습니다</p>
        <ul v-else class="qlist">
          <li v-for="it in items" :key="it.itemId">
            <button type="button" class="qitem" :aria-current="it.itemId === itemId ? 'true' : undefined" @click="select(it.itemId)">
              <span class="row">
                <b class="title-sm">{{ it.caseNo }}</b>
                <StatusBadge :tone="STATUS[it.status]?.tone ?? 'na'" :label="STATUS[it.status]?.label ?? it.status" />
                <span class="caption">{{ it.defectTypeName ?? '하자 종류 미입력' }} · {{ it.buildingName }}</span>
              </span>
              <span class="body-sm diffline"
                ><span class="muted">AI</span> {{ it.aiTopCause ?? '-' }} <span class="muted">- 현장</span>
                {{ it.fieldNote ?? '점검 내용 없음' }}</span
              >
            </button>
          </li>
        </ul>
      </section>

      <!-- 상세 -->
      <section v-if="itemId" id="s4-detail" class="detail" tabindex="-1" aria-label="비교와 판정">
        <RetryBox v-if="detailErr" :message="detailErr" :busy="detailLoading" @retry="loadDetail(itemId)" />
        <p v-if="detailLoading && !detail" class="skeleton" style="height: 240px"></p>
        <template v-if="detail">
          <div class="row-between">
            <h2 class="title-lg">비교 - {{ detail.caseNo }}</h2>
            <StatusBadge :tone="STATUS[detail.status]?.tone ?? 'na'" :label="STATUS[detail.status]?.label ?? detail.status" size="md" />
          </div>

          <CategoryTabs v-if="isMobile" v-model="side" :tabs="sideTabs" label="비교 구분" />
          <div class="compare">
            <div v-show="!isMobile || side === 'ai'" class="col" role="group" aria-label="사용자 · AI">
              <AiResultBrief
                :result="detail.analysis.result"
                :photos="detail.analysis.photos"
                :description="detail.analysis.description"
                heading="사용자 사진 · AI 분석"
              />
            </div>
            <div v-show="!isMobile || side === 'field'" class="col" role="group" aria-label="현장 기록">
              <div class="field-rec">
                <p class="label-upper muted">현장 점검 기록</p>
                <div v-if="detail.record.photos.length" class="photos">
                  <PhotoThumb v-for="p in detail.record.photos" :key="p.kind + p.photoId" :photo="p" />
                </div>
                <p v-else class="body-sm muted">현장 사진 없음</p>
                <dl class="dl">
                  <dt>건물</dt>
                  <dd>{{ detail.record.buildingName }} · {{ detail.record.buildingTypeName }}</dd>
                  <dt>위치</dt>
                  <dd>{{ detail.record.locationText ?? '-' }}</dd>
                  <dt>하자 종류</dt>
                  <dd>{{ detail.record.defectTypeName ?? '-' }}</dd>
                  <dt>보수 결과</dt>
                  <dd>
                    {{
                      detail.record.repairStatus === 'completed'
                        ? '완료'
                        : detail.record.repairStatus === 'pending'
                          ? '미완료 - 보수 예정'
                          : '-'
                    }}
                  </dd>
                  <dt>보수 방법</dt>
                  <dd>{{ detail.record.repairMethod ?? '-' }}</dd>
                  <dt>점검 내용</dt>
                  <dd>{{ detail.record.inspectionNote ?? '-' }}</dd>
                  <dt>AI 일치</dt>
                  <dd>{{ AI_MATCH[detail.record.aiMatch] ?? '-' }}</dd>
                  <dt>기록</dt>
                  <dd>{{ detail.record.recorder?.nameMasked ?? '-' }} · {{ fmtDate(detail.record.savedAt, true) }}</dd>
                </dl>
              </div>
            </div>
          </div>

          <!-- 자료 요청 이력 -->
          <div v-if="detail.dataRequests.length" class="hist">
            <h3 class="title-md">추가 자료 요청</h3>
            <ul class="vlist">
              <li v-for="d in detail.dataRequests" :key="d.dataReqId" class="vitem">
                <span class="row">
                  <StatusBadge :tone="d.open ? 'warn' : 'ok'" :label="d.open ? '요청 중' : '자료 도착 - 해소'" />
                  <span class="caption"
                    >{{ d.expert?.nameMasked ?? '-' }} · 보냄 {{ fmtDate(d.sentAt, true)
                    }}<template v-if="d.resolvedAt"> · 해소 {{ fmtDate(d.resolvedAt, true) }}</template></span
                  >
                </span>
                <span class="body-sm">{{ d.reason }}</span>
              </li>
            </ul>
          </div>

          <!-- 판정 이력 (FR-042 판본 누적) -->
          <div class="hist">
            <h3 class="title-md">판정 이력</h3>
            <p v-if="!detail.verdicts.length" class="body-sm muted">아직 판정이 없습니다</p>
            <ul v-else class="vlist">
              <li v-for="v in detail.verdicts" :key="v.verdictId" class="vitem" :class="{ current: v.current }">
                <span class="row">
                  <b class="title-sm">v{{ v.versionNo }}</b>
                  <StatusBadge :tone="v.verdict === 'match' ? 'ok' : 'warn'" :label="v.verdict === 'match' ? '일치' : '불일치'" />
                  <StatusBadge v-if="v.riskHigh" tone="danger" label="위험 큼" />
                  <StatusBadge v-if="v.current" tone="ref" label="현재 판정" />
                  <span class="caption">{{ v.expert?.nameMasked ?? '-' }} · {{ fmtDate(v.decidedAt, true) }}</span>
                </span>
                <span v-if="v.opinion" class="body-sm">의견: {{ v.opinion }}</span>
                <span v-if="v.diffNote" class="body-sm">AI 와의 차이: {{ v.diffNote }}</span>
              </li>
            </ul>
          </div>

          <!-- 판정 -->
          <form v-if="canJudge" class="verdict panel" novalidate @submit.prevent="submitVerdict">
            <h3 class="title-md">{{ detail.verdicts.length ? `새 판정 (v${detail.verdicts[0].versionNo + 1})` : '판정' }}</h3>
            <AlertBox v-if="savedMsg" tone="ok" title="저장했습니다">{{ savedMsg }}</AlertBox>
            <AlertBox v-if="reqSentMsg" tone="info" title="요청 보냄">{{ reqSentMsg }}</AlertBox>

            <C2GateBlock v-if="shownGate" :block="shownGate" :sent-at="openRequest ? `${fmtDate(openRequest.sentAt, true)}` : null" />

            <fieldset
              class="fs"
              :aria-invalid="formErr.verdict ? 'true' : undefined"
              :aria-describedby="formErr.verdict ? 's4-v-err' : undefined"
            >
              <legend class="field-label req">판정</legend>
              <div class="choice-group">
                <label class="choice">
                  <input id="s4-v-match" v-model="form.verdict" type="radio" name="s4-verdict" value="match" />
                  일치
                </label>
                <label class="choice">
                  <input v-model="form.verdict" type="radio" name="s4-verdict" value="mismatch" />
                  불일치
                </label>
              </div>
              <span v-if="formErr.verdict" id="s4-v-err" class="err">{{ formErr.verdict }}</span>
            </fieldset>

            <div class="field">
              <label for="s4-opinion"
                >전문가 의견 <span class="muted">{{ form.verdict === 'match' ? '(일치 시 생략 가능)' : '(선택)' }}</span></label
              >
              <textarea id="s4-opinion" v-model="form.opinion" class="textarea" maxlength="1000"></textarea>
            </div>

            <div v-if="form.verdict === 'mismatch'" class="field">
              <label for="s4-diff" class="req">AI 와의 차이 내용</label>
              <textarea
                id="s4-diff"
                v-model="form.diffNote"
                class="textarea"
                maxlength="500"
                :aria-invalid="formErr.diffNote ? 'true' : undefined"
                :aria-describedby="formErr.diffNote ? 's4-diff-err' : 's4-diff-hint'"
                placeholder="예: AI 는 건조수축으로 봤으나 현장은 구조 균열"
              ></textarea>
              <span v-if="formErr.diffNote" id="s4-diff-err" class="err">{{ formErr.diffNote }}</span>
              <span v-else id="s4-diff-hint" class="hint">불일치 판정은 AI 신뢰도 지표에 반영됩니다</span>
            </div>

            <label class="choice check-row">
              <input v-model="form.riskHigh" type="checkbox" />
              <span class="box" aria-hidden="true"></span>
              위험 큼 - 저장하면 건물 관리자에게 전문가 점검 필요 통지
            </label>

            <!-- 판정 불가 — 다른 축의 별도 행동 -->
            <C2GateBlock v-if="unable && !shownGate" :block="localG6">
              <div class="unable" role="group" aria-label="판정 불가 - 추가 자료 요청">
                <div class="field">
                  <label for="s4-unable-reason" class="req">판정할 수 없는 사유</label>
                  <textarea
                    id="s4-unable-reason"
                    v-model="unableReason"
                    class="textarea"
                    maxlength="200"
                    :aria-invalid="unableErr ? 'true' : undefined"
                    aria-describedby="s4-unable-hint"
                    placeholder="예: 현장 사진 초점이 흐려 균열 폭을 알 수 없습니다"
                  ></textarea>
                  <span v-if="unableErr" class="err" role="alert">{{ unableErr }}</span>
                  <span id="s4-unable-hint" class="hint"
                    >기록한 시설관리자에게 요청이 전달됩니다. 판정 데이터로는 쌓이지 않습니다. {{ unableReason.length }}/200</span
                  >
                </div>
                <div class="row">
                  <BaseButton size="sm" :busy="unableBusy" @click="sendDataRequest">추가 자료 요청 보내기</BaseButton>
                  <BaseButton size="sm" variant="secondary" @click="cancelUnable">취소</BaseButton>
                </div>
              </div>
            </C2GateBlock>

            <RetryBox v-if="submitErr" :message="submitErr" keeps-input :busy="busy" @retry="submitVerdict" />

            <div class="verdict-actions">
              <C3ReasonedButton type="submit" :busy="busy" :disabled="g6Active" :gate="g6Active ? 'G6' : null">검증 완료</C3ReasonedButton>
              <BaseButton v-if="canRequest && !shownGate && !unable" variant="secondary" @click="openUnable">판정 불가</BaseButton>
            </div>
          </form>
          <p v-else class="body-sm muted">판정 권한이 없어 읽기만 할 수 있습니다.</p>
        </template>
      </section>
      <p v-else-if="items.length" class="empty" style="margin-top: 16px">목록에서 건을 선택하면 비교와 판정 영역이 열립니다</p>
    </div>
  </div>
</template>

<style scoped>
.trust {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--s-md);
  margin-bottom: var(--s-xl);
}
.queue {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.filters {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.qlist {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--hairline);
  max-height: 420px;
  overflow-y: auto;
}
.qitem {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--s-xxs);
  width: 100%;
  min-height: 64px;
  padding: var(--s-sm) var(--s-md);
  border: 0;
  border-bottom: 1px solid var(--hairline);
  background: var(--canvas);
  text-align: left;
  color: var(--body);
  cursor: pointer;
}
.qitem:hover {
  background: var(--surface-soft);
}
.qitem[aria-current='true'] {
  border-left: 4px solid var(--ink);
  background: var(--surface-soft);
}
.diffline {
  overflow-wrap: anywhere;
}
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  margin-top: var(--s-xl);
  padding-top: var(--s-lg);
  border-top: 2px solid var(--ink);
  outline: none;
}
.compare {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-lg);
  align-items: start;
}
.col {
  min-width: 0;
}
.field-rec {
  border: 1px solid var(--hairline);
  padding: var(--s-md);
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.field-rec .dl dd {
  overflow-wrap: anywhere;
}
.photos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--s-xs);
}
.hist {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.vlist {
  border-top: 1px solid var(--hairline);
}
.vitem {
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
  padding: var(--s-sm) 0;
  border-bottom: 1px solid var(--hairline);
}
.vitem.current {
  border-left: 4px solid var(--ink);
  padding-left: var(--s-sm);
}
.verdict {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}
.verdict :deep(.gate) {
  margin: 0;
}
.fs {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.fs[aria-invalid='true'] .choice {
  border-color: var(--error);
}
.err {
  font: var(--t-body-sm);
  color: var(--error-text);
}
.unable {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  margin-top: var(--s-sm);
}
.verdict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-sm);
  align-items: flex-start;
}
@media (max-width: 1023px) {
  .trust {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 767px) {
  .compare {
    grid-template-columns: minmax(0, 1fr);
  }
  .verdict-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .verdict-actions :deep(.reasoned) {
    width: 100%;
  }
  .verdict-actions :deep(.rbtn) {
    width: 100%;
  }
}
</style>
