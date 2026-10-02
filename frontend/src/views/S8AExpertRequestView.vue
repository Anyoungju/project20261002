<script setup lang="ts">
/**
 * S8A 전문가 점검 요청 (UC7 · P8 8.1~8.5 · SD_02 §11)
 * 한 화면: (1) 하자 건 자동 선택(C6 접힘 + C1 레일) → (2) 조건(분야·희망 기간) → (3) 후보(G8)
 *        → (4) 확정 전 고지(수수료·공유 범위, C4 share) + 동의 체크(G9) → [요청 확정] → (5) 상태(G10)
 * U6 — 돈과 공유 범위는 [요청 확정] 보다 먼저 보인다. 연락처는 연결 확정 뒤에만(서버 제공).
 * FR-102 — 신규 조건 입력은 초안(S8A:new:<caseId>)에 보존.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, get, patch, GateBlockError, ApiError, newIdempotencyKey, errorMessage, type GateBlock } from '@/api/client';
import { useReference } from '@/stores/reference';
import { loadDraft, saveDraft, clearDraft } from '@/stores/drafts';
import { fmtDate } from '@/composables/useCan';
import { requestStatus, attemptResponse, ORIGIN_LABEL, fmtDateTime, feeText, isoDay } from '@/components/expert/expertLabels';
import C1ProgressRail from '@/components/common/C1ProgressRail.vue';
import C2GateBlock from '@/components/common/C2GateBlock.vue';
import C3ReasonedButton from '@/components/common/C3ReasonedButton.vue';
import C4ReferenceNotice from '@/components/common/C4ReferenceNotice.vue';
import C6CaseSummary from '@/components/common/C6CaseSummary.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import OptionTile from '@/components/base/OptionTile.vue';
import RetryBox from '@/components/base/RetryBox.vue';
import AlertBox from '@/components/base/AlertBox.vue';

const route = useRoute();
const router = useRouter();
const reference = useReference();

const expReqId = computed(() => (route.params.expReqId ? Number(route.params.expReqId) : null));
const isNew = computed(() => expReqId.value == null);
const qCaseId = computed(() => (route.query.caseId ? Number(route.query.caseId) : null));
const qRiskNoticeId = computed(() => (route.query.riskNoticeId ? Number(route.query.riskNoticeId) : null));
const qOrigin = computed(() => (typeof route.query.origin === 'string' ? route.query.origin : null));
const draftKey = computed(() => (qCaseId.value ? `S8A:new:${qCaseId.value}` : null));

// ---------------------------------------------------------------- 상태
const loading = ref(true);
const loadErr = ref('');
const pageGate = ref<GateBlock | null>(null);
const detail = ref<any | null>(null);
const caseSum = ref<any | null>(null);
const progress = ref<any | null>(null);

const form = ref({ specialtyCode: '', wishFrom: isoDay(0), wishTo: isoDay(7) });
const condBusy = ref(false);
const condErr = ref('');
const condGate = ref<GateBlock | null>(null);
const condRetryable = ref(false);
const condForm = ref<HTMLElement | null>(null);

const choosing = ref(false); // 후보 선택 단계(작성 중 · 미확정에서 [다른 후보])
const candLoading = ref(false);
const candErr = ref('');
const candidates = ref<any[]>([]);
const candGate = ref<GateBlock | null>(null);
const selectedExpertId = ref<number | null>(null);

const preview = ref<any | null>(null);
const previewLoading = ref(false);
const previewErr = ref('');
const consent = ref(false);
const consentBox = ref<HTMLInputElement | null>(null);

const confirmBusy = ref(false);
const confirmGate = ref<GateBlock | null>(null);
const confirmErr = ref('');
const confirmInfo = ref('');
let confirmKey = newIdempotencyKey();

const status = computed<string>(() => (isNew.value ? 'new' : (detail.value?.status ?? 'drafting')));
const editable = computed(() => isNew.value || status.value === 'drafting' || (status.value === 'not_confirmed' && choosing.value));
const originKind = computed(() => (isNew.value ? (qOrigin.value ?? 'direct') : (detail.value?.originKind ?? 'direct')));
const connectedAttempt = computed(() => (detail.value?.attempts ?? []).find((a: any) => a.connection) ?? null);
const rangeInvalid = computed(() => !!form.value.wishFrom && !!form.value.wishTo && form.value.wishFrom > form.value.wishTo);
const condReason = computed(() => {
  if (!form.value.specialtyCode) return '전문 분야를 선택해 주세요';
  if (!form.value.wishFrom || !form.value.wishTo) return '희망 기간을 입력해 주세요';
  if (rangeInvalid.value) return '희망 시작일이 종료일보다 늦습니다';
  return null;
});
const condChanged = computed(
  () =>
    !detail.value ||
    detail.value.specialtyCode !== form.value.specialtyCode ||
    String(detail.value.wishFrom).slice(0, 10) !== form.value.wishFrom ||
    String(detail.value.wishTo).slice(0, 10) !== form.value.wishTo,
);
const selectedCandidate = computed(() => candidates.value.find((c) => c.expertId === selectedExpertId.value) ?? null);

const confirmGateCode = computed(() => {
  if (candGate.value) return 'G8';
  if (selectedCandidate.value && preview.value && !consent.value) return 'G9';
  return null;
});
const confirmReason = computed(() => {
  if (confirmGateCode.value) return null;
  if (condChanged.value && !isNew.value) return '바뀐 조건으로 먼저 후보를 다시 찾아 주세요';
  if (!selectedCandidate.value) return '후보 전문가를 선택해 주세요';
  if (!preview.value) return '확정 전 고지를 확인해 주세요';
  return null;
});

// ---------------------------------------------------------------- 불러오기
function applyDetail(d: any) {
  detail.value = d;
  caseSum.value = d.case ?? null;
  progress.value = d.progress ?? null;
  form.value = { specialtyCode: d.specialtyCode, wishFrom: String(d.wishFrom).slice(0, 10), wishTo: String(d.wishTo).slice(0, 10) };
}

async function load() {
  loading.value = true;
  loadErr.value = '';
  pageGate.value = null;
  try {
    if (isNew.value) {
      if (!qCaseId.value) {
        loadErr.value = '';
        return;
      }
      const [c, p] = await Promise.all([get(`/api/cases/${qCaseId.value}`), get(`/api/cases/${qCaseId.value}/progress`).catch(() => null)]);
      caseSum.value = c;
      progress.value = p;
      const d = draftKey.value ? loadDraft<typeof form.value>(draftKey.value) : null;
      if (d) Object.assign(form.value, d);
    } else {
      applyDetail(await get(`/api/expert-requests/${expReqId.value}`));
      if (status.value === 'drafting') {
        choosing.value = true;
        await loadCandidates();
      }
    }
  } catch (e) {
    if (e instanceof GateBlockError) pageGate.value = e.block;
    else loadErr.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

async function reloadDetail() {
  if (!expReqId.value) return;
  try {
    applyDetail(await get(`/api/expert-requests/${expReqId.value}`));
  } catch (e) {
    if (e instanceof GateBlockError) pageGate.value = e.block;
    else loadErr.value = errorMessage(e);
  }
}

function resetSelection() {
  selectedExpertId.value = null;
  preview.value = null;
  previewErr.value = '';
  consent.value = false;
  confirmGate.value = null;
  confirmErr.value = '';
  confirmKey = newIdempotencyKey();
}

async function loadCandidates() {
  if (!expReqId.value) return;
  candLoading.value = true;
  candErr.value = '';
  resetSelection();
  try {
    const r = await get<{ candidates: any[]; gate: GateBlock | null }>(`/api/expert-requests/${expReqId.value}/candidates`);
    candidates.value = r.candidates ?? [];
    candGate.value = r.gate ?? null;
  } catch (e) {
    candidates.value = [];
    if (e instanceof GateBlockError) candGate.value = e.block;
    else candErr.value = errorMessage(e);
  } finally {
    candLoading.value = false;
  }
}

// ---------------------------------------------------------------- (2) 조건 → 후보 찾기
async function submitConditions() {
  if (condBusy.value || condReason.value) return;
  condBusy.value = true;
  condErr.value = '';
  condGate.value = null;
  condRetryable.value = false;
  try {
    if (isNew.value) {
      const d = await api('/api/expert-requests', {
        method: 'POST',
        body: {
          caseId: qCaseId.value,
          riskNoticeId: qRiskNoticeId.value ?? undefined,
          originKind: qOrigin.value ?? undefined,
          specialtyCode: form.value.specialtyCode,
          wishFrom: form.value.wishFrom,
          wishTo: form.value.wishTo,
        },
      });
      if (draftKey.value) clearDraft(draftKey.value);
      // 같은 화면, :key=path 가 바뀌어 다시 마운트되며 후보까지 불러온다
      await router.replace(`/expert-requests/${d.expReqId}`);
      return;
    }
    if (condChanged.value) {
      applyDetail(await patch(`/api/expert-requests/${expReqId.value}`, { ...form.value }));
    }
    await loadCandidates();
  } catch (e) {
    if (e instanceof GateBlockError) condGate.value = e.block;
    else {
      condErr.value = errorMessage(e);
      condRetryable.value = !(e instanceof ApiError) || e.status >= 500;
    }
  } finally {
    condBusy.value = false;
  }
}

function focusConditions() {
  nextTick(() => {
    const el = condForm.value?.querySelector<HTMLElement>('input:not([disabled])');
    condForm.value?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el?.focus();
  });
}

// ---------------------------------------------------------------- (4) 후보 선택 → 확정 전 고지
async function choose(expertId: number) {
  if (selectedExpertId.value === expertId && preview.value) return;
  selectedExpertId.value = expertId;
  preview.value = null;
  consent.value = false; // 후보가 바뀌면 새 동의가 필요하다
  confirmGate.value = null;
  confirmErr.value = '';
  confirmKey = newIdempotencyKey();
  await loadPreview();
}

async function loadPreview() {
  if (!expReqId.value || !selectedExpertId.value) return;
  previewLoading.value = true;
  previewErr.value = '';
  try {
    preview.value = await get(`/api/expert-requests/${expReqId.value}/preview`, { expertId: selectedExpertId.value });
  } catch (e) {
    if (e instanceof GateBlockError) confirmGate.value = e.block;
    else previewErr.value = errorMessage(e);
  } finally {
    previewLoading.value = false;
  }
}

async function confirmRequest() {
  if (confirmBusy.value || confirmGateCode.value || confirmReason.value || !preview.value) return;
  confirmBusy.value = true;
  confirmGate.value = null;
  confirmErr.value = '';
  confirmInfo.value = '';
  try {
    const d = await api(`/api/expert-requests/${expReqId.value}/confirm`, {
      method: 'POST',
      body: {
        expertId: selectedExpertId.value,
        consent: consent.value,
        scopeText: preview.value.scopeText,
        noticeId: preview.value.notice?.noticeId ?? 0,
      },
      idempotencyKey: confirmKey,
    });
    confirmKey = newIdempotencyKey();
    applyDetail(d);
    choosing.value = false;
    candidates.value = [];
    candGate.value = null;
    resetSelection();
    await nextTick();
    document.getElementById('s8a-status')?.focus();
  } catch (e) {
    confirmKey = newIdempotencyKey();
    if (e instanceof GateBlockError) {
      confirmGate.value = e.block;
      if (e.block.gate === 'G8') await loadCandidates();
    } else if (e instanceof ApiError && e.code === 'notice_changed') {
      consent.value = false;
      confirmInfo.value = e.message;
      await loadPreview();
    } else if (e instanceof ApiError && (e.code === 'awaiting' || e.code === 'request_closed')) {
      confirmInfo.value = e.message;
      choosing.value = false;
      await reloadDetail();
    } else confirmErr.value = errorMessage(e);
  } finally {
    confirmBusy.value = false;
  }
}

function onGateAction(a: { id: string }) {
  if (a.id === 'change-conditions') focusConditions();
  else if (a.id === 'consent') {
    nextTick(() => consentBox.value?.focus());
  } else if (a.id === 'other-candidate') {
    choosing.value = true;
    loadCandidates();
    nextTick(() => document.getElementById('s8a-candidates')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
}

// FR-102 — 신규 조건 초안 보존
watch(
  form,
  (v) => {
    if (isNew.value && draftKey.value) saveDraft(draftKey.value, v);
  },
  { deep: true },
);

onMounted(async () => {
  reference.load().catch(() => undefined);
  await load();
});

const statusView = computed(() => requestStatus(detail.value?.status));
const lastAttempt = computed(() => {
  const a = detail.value?.attempts ?? [];
  return a.length ? a[a.length - 1] : null;
});
const specialtyName = (code: string) => reference.specialties.find((s) => s.code === code)?.name ?? code;
</script>

<template>
  <div>
    <C1ProgressRail v-if="progress" variant="case" :title="`하자 건 ${progress.caseNo}`" :stages="progress.stages" />
    <div class="container page">
      <p><RouterLink to="/expert-requests" class="body-sm">‹ 전문가 연결 목록</RouterLink></p>
      <div class="page-head">
        <div>
          <p class="eyebrow">전문가 점검 연결</p>
          <h1 class="display-md">{{ isNew ? '전문가 점검 요청' : `점검 요청 #${expReqId}` }}</h1>
          <p class="body-md muted" style="margin-top: 8px">
            진입: <b>{{ ORIGIN_LABEL[originKind] ?? originKind }}</b>
            <template v-if="!isNew && detail"> · 요청일 {{ fmtDate(detail.createdAt, true) }}</template>
          </p>
        </div>
        <StatusBadge v-if="!isNew && detail" :tone="statusView.tone" :label="statusView.label" size="md" />
      </div>

      <C2GateBlock v-if="pageGate" :block="pageGate" />
      <RetryBox v-else-if="loadErr" :message="loadErr" @retry="load" />
      <p v-else-if="loading" class="empty" role="status">불러오는 중</p>
      <div v-else-if="isNew && !qCaseId" class="stack">
        <p class="empty">요청할 하자 건이 선택되지 않았습니다. 위험 통지나 분석 결과에서 [전문가 점검 요청]으로 들어와 주세요.</p>
        <BaseButton variant="secondary" to="/expert-requests">위험 통지 목록으로</BaseButton>
      </div>

      <div v-else class="flow">
        <!-- ============================================ (1) 하자 건 -->
        <section class="step" aria-labelledby="s8a-step-case">
          <h2 id="s8a-step-case" class="title-lg"><span class="num">1</span>하자 건</h2>
          <C6CaseSummary v-if="caseSum" :summary="caseSum" variant="collapsed" />
          <p v-if="caseSum && !caseSum.building" class="body-sm err">건물에 연결되지 않은 하자 건은 전문가 연결을 요청할 수 없습니다.</p>
        </section>

        <!-- ============================================ (5) 상태 (요청 후) -->
        <section v-if="!isNew && detail && detail.attempts?.length" class="step" aria-labelledby="s8a-status">
          <h2 id="s8a-status" class="title-lg" tabindex="-1"><span class="num">5</span>연결 상태</h2>
          <AlertBox v-if="confirmInfo && !choosing" tone="info" title="요청 상태가 바뀌었습니다">{{ confirmInfo }}</AlertBox>
          <C2GateBlock v-if="detail.gate && !(status === 'not_confirmed' && choosing)" :block="detail.gate" @action="onGateAction" />

          <div v-if="status === 'connected' && connectedAttempt" class="connected panel-soft">
            <div class="row">
              <StatusBadge tone="ok" label="연결 확정" size="md" />
              <span class="title-sm">{{ connectedAttempt.expert?.nameMasked ?? '전문가' }} 전문가와 연결되었습니다</span>
            </div>
            <dl class="dl">
              <dt>확정 시각</dt>
              <dd>{{ fmtDateTime(connectedAttempt.connection.confirmedAt) }}</dd>
              <dt>연결 수수료</dt>
              <dd>{{ feeText(connectedAttempt.connection.feeAmount) }}</dd>
              <template v-if="detail.contact">
                <dt>전문가 이름</dt>
                <dd>{{ detail.contact.name }}</dd>
                <dt>이메일</dt>
                <dd>
                  <a :href="`mailto:${detail.contact.email}`">{{ detail.contact.email }}</a>
                </dd>
                <dt>전화</dt>
                <dd>
                  <a v-if="detail.contact.phone" :href="`tel:${detail.contact.phone}`">{{ detail.contact.phone }}</a>
                  <span v-else class="muted">등록되지 않음</span>
                </dd>
              </template>
            </dl>
            <p class="caption">연락처는 연결이 확정된 뒤에만 양측에 공개됩니다.</p>
          </div>

          <h3 class="title-md">요청 이력</h3>
          <ol class="attempts">
            <li v-for="(a, i) in detail.attempts" :key="a.attemptId" class="attempt">
              <div class="row-between">
                <span class="title-sm">{{ i + 1 }}차 · {{ a.expert?.nameMasked ?? '전문가' }}</span>
                <StatusBadge :tone="attemptResponse(a.response).tone" :label="attemptResponse(a.response).label" />
              </div>
              <dl class="dl">
                <dt>보낸 시각</dt>
                <dd>{{ fmtDateTime(a.sentAt) }}</dd>
                <dt>응답 시각</dt>
                <dd>{{ a.respondedAt ? fmtDateTime(a.respondedAt) : '응답 전' }}</dd>
                <template v-if="a.response === 'declined'">
                  <dt>거절 사유</dt>
                  <dd>{{ a.declineReason || '사유 없음' }}</dd>
                </template>
                <dt>동의 시각</dt>
                <dd>{{ fmtDateTime(a.consentedAt) }}</dd>
                <dt>공유 범위</dt>
                <dd>{{ a.scopeText }}</dd>
                <template v-if="a.connection">
                  <dt>연결 수수료</dt>
                  <dd>{{ feeText(a.connection.feeAmount) }}</dd>
                </template>
              </dl>
            </li>
          </ol>
          <p v-if="status === 'not_confirmed' && lastAttempt && !choosing" class="caption">거절·무응답에는 수수료가 발생하지 않습니다.</p>
        </section>

        <!-- ============================================ (2) 조건 -->
        <section v-if="editable || isNew" ref="condForm" class="step" aria-labelledby="s8a-step-cond">
          <h2 id="s8a-step-cond" class="title-lg"><span class="num">2</span>조건</h2>
          <form class="stack" @submit.prevent="submitConditions">
            <fieldset class="field">
              <legend class="field-label req">전문 분야</legend>
              <div class="choice-group">
                <label v-for="s in reference.specialties" :key="s.code" class="choice">
                  <input v-model="form.specialtyCode" type="radio" name="s8a-specialty" :value="s.code" />
                  {{ s.name }}
                </label>
                <span v-if="!reference.specialties.length" class="caption">분야 목록을 불러오는 중입니다</span>
              </div>
            </fieldset>
            <div class="grid-2 dates">
              <div class="field">
                <label for="s8a-from" class="req">희망 시작일</label>
                <input id="s8a-from" v-model="form.wishFrom" class="input" type="date" required :aria-invalid="rangeInvalid || undefined" />
              </div>
              <div class="field">
                <label for="s8a-to" class="req">희망 종료일</label>
                <input
                  id="s8a-to"
                  v-model="form.wishTo"
                  class="input"
                  type="date"
                  required
                  :min="form.wishFrom"
                  :aria-invalid="rangeInvalid || undefined"
                  aria-describedby="s8a-range-hint"
                />
                <span id="s8a-range-hint" class="hint">이 기간에 현장 점검이 가능한 전문가만 후보로 나옵니다.</span>
              </div>
            </div>
            <C2GateBlock v-if="condGate" :block="condGate" @action="onGateAction" />
            <RetryBox v-if="condErr && condRetryable" :message="condErr" keeps-input @retry="submitConditions" />
            <p v-else-if="condErr" class="body-sm err" role="alert">{{ condErr }}</p>
            <div class="cond-actions">
              <C3ReasonedButton
                type="submit"
                :busy="condBusy"
                :disabled="!!condReason || (isNew && !caseSum?.building)"
                :reason="condReason ?? (isNew && !caseSum?.building ? '건물에 연결된 하자 건만 요청할 수 있습니다' : null)"
                variant="secondary"
              >
                후보 찾기
              </C3ReasonedButton>
              <span v-if="!isNew && detail" class="caption"
                >현재 조건: {{ specialtyName(detail.specialtyCode) }} · {{ fmtDate(detail.wishFrom) }} ~ {{ fmtDate(detail.wishTo) }}</span
              >
            </div>
          </form>
        </section>

        <!-- 조건 요약(잠김) -->
        <section v-else-if="detail" class="step" aria-labelledby="s8a-step-cond-ro">
          <h2 id="s8a-step-cond-ro" class="title-lg"><span class="num">2</span>조건</h2>
          <dl class="dl">
            <dt>전문 분야</dt>
            <dd>{{ detail.specialtyName }}</dd>
            <dt>희망 기간</dt>
            <dd>{{ fmtDate(detail.wishFrom) }} ~ {{ fmtDate(detail.wishTo) }}</dd>
          </dl>
        </section>

        <!-- ============================================ (3)(4) 후보 · 확정 전 고지 -->
        <section v-if="!isNew && choosing" id="s8a-candidates" class="step expert" aria-labelledby="s8a-step-cand">
          <div class="m-stripe" aria-hidden="true"></div>
          <h2 id="s8a-step-cand" class="title-lg"><span class="num">3</span>후보 전문가</h2>
          <p v-if="status === 'not_confirmed'" class="body-sm muted">
            이미 요청을 보낸 전문가는 후보에서 빠집니다. 새 후보에게 보내려면 공유 범위에 다시 동의해야 합니다.
          </p>
          <RetryBox v-if="candErr" :message="candErr" @retry="loadCandidates" />
          <p v-else-if="candLoading" class="empty" role="status">후보를 찾는 중</p>
          <C2GateBlock v-else-if="candGate" :block="candGate" @action="onGateAction" />
          <div v-else-if="candidates.length" class="cands" role="radiogroup" aria-label="후보 전문가">
            <OptionTile
              v-for="c in candidates"
              :key="c.expertId"
              name="s8a-expert"
              :value="String(c.expertId)"
              :selected="selectedExpertId === c.expertId"
              :title="c.expert?.nameMasked ?? '전문가'"
              @select="choose(Number($event))"
            >
              <span class="body-sm">분야 {{ c.specialties.join(' · ') }}</span>
              <span class="caption days">가능일 {{ c.availableDays.map((d: string) => d.slice(5)).join(', ') }}</span>
            </OptionTile>
          </div>

          <template v-if="selectedCandidate">
            <h2 class="title-lg"><span class="num">4</span>확정 전 고지</h2>
            <RetryBox v-if="previewErr" :message="previewErr" @retry="loadPreview" />
            <p v-else-if="previewLoading" class="empty" role="status">고지 내용을 불러오는 중</p>
            <C4ReferenceNotice v-else-if="preview" :notice="preview.notice" variant="share">
              <dl class="dl share-dl">
                <dt>전문가</dt>
                <dd>{{ preview.expert?.nameMasked ?? selectedCandidate.expert?.nameMasked }}</dd>
                <dt>연결 수수료</dt>
                <dd>
                  <b>{{ preview.fee?.amount != null ? `${preview.fee.amount.toLocaleString('ko-KR')}원` : '요율 미설정' }}</b>
                  <br />{{ preview.fee?.text }}
                </dd>
                <dt>공유 자료</dt>
                <dd>{{ preview.scopeText }}</dd>
              </dl>
            </C4ReferenceNotice>
            <AlertBox v-if="confirmInfo && choosing" tone="warn" title="다시 확인해 주세요">{{ confirmInfo }}</AlertBox>
            <label v-if="preview" class="choice check-row">
              <input ref="consentBox" v-model="consent" type="checkbox" />
              <span class="box" aria-hidden="true"></span>
              위 공유 범위와 수수료 안내에 동의합니다
            </label>
          </template>

          <C2GateBlock v-if="confirmGate" :block="confirmGate" @action="onGateAction" />
          <RetryBox v-if="confirmErr" :message="confirmErr" :busy="confirmBusy" @retry="confirmRequest" />
          <div class="sticky-actions confirm-bar">
            <C3ReasonedButton
              :busy="confirmBusy"
              :disabled="!!confirmGateCode || !!confirmReason"
              :gate="confirmGateCode"
              :reason="confirmReason"
              @click="confirmRequest"
            >
              요청 확정
            </C3ReasonedButton>
            <span class="caption">확정하면 선택한 전문가 1명에게만 요청과 동의한 자료가 전달됩니다.</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flow {
  display: flex;
  flex-direction: column;
  gap: var(--s-xl);
  max-width: 960px;
}
.step {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}
.num {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: var(--s-xs);
  background: var(--ink);
  color: var(--on-dark);
  font: var(--t-label);
  vertical-align: middle;
}
.err {
  color: var(--error-text);
}
fieldset.field {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.dates {
  gap: var(--s-md);
}
.cond-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-sm);
  align-items: center;
}
.expert {
  border: 1px solid var(--hairline);
  padding: 0 var(--s-lg) var(--s-lg);
}
.expert > .m-stripe {
  margin: 0 calc(-1 * var(--s-lg));
}
.cands {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--s-sm);
}
.days {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.share-dl {
  margin-top: var(--s-sm);
}
.share-dl dd {
  overflow-wrap: anywhere;
}
.confirm-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-sm);
}
.connected {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.attempts {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.attempt {
  border: 1px solid var(--hairline);
  padding: var(--s-md);
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.attempt .dl dd {
  overflow-wrap: anywhere;
}
@media (max-width: 767px) {
  .expert {
    padding: 0 var(--s-md) var(--s-md);
  }
  .expert > .m-stripe {
    margin: 0 calc(-1 * var(--s-md));
  }
  .dates {
    grid-template-columns: minmax(0, 1fr);
  }
  .dl {
    grid-template-columns: minmax(0, 1fr);
  }
  .dl dt {
    margin-top: var(--s-xs);
  }
}
</style>
