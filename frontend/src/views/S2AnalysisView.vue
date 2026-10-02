<script setup lang="ts">
/**
 * S2 하자 사진 AI 분석 (UC1 · P2 · SD_02 §5)
 * 입력: 사진(1장 이상) + 설명(선택) → [분석 요청]. G2(이용권) · G3(품질) · G4(AI 실패)는 C2 블록.
 * 결과: 원인(순위)·대응방안 + 카드 안의 C4 고지(닫기 없음) + C5 위험 권고(버튼은 권한자만).
 * 입력값 보존(FR-102): 설명 localStorage, 사진 IndexedDB.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, get, GateBlockError, newIdempotencyKey, NetworkError, errorMessage, type GateBlock } from '@/api/client';
import { useSession } from '@/stores/session';
import { loadDraft, saveDraft, clearDraft, saveDraftPhotos, loadDraftPhotos } from '@/stores/drafts';
import { RISK_LABEL, riskTone, fmtDate } from '@/composables/useCan';
import C1ProgressRail from '@/components/common/C1ProgressRail.vue';
import C2GateBlock from '@/components/common/C2GateBlock.vue';
import C3ReasonedButton from '@/components/common/C3ReasonedButton.vue';
import C4ReferenceNotice from '@/components/common/C4ReferenceNotice.vue';
import C5RiskRecommendation from '@/components/common/C5RiskRecommendation.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import PhotoThumb from '@/components/common/PhotoThumb.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import PhotoPicker from '@/components/base/PhotoPicker.vue';
import RetryBox from '@/components/base/RetryBox.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();

const DRAFT = 'S2:new';
const photos = ref<File[]>([]);
const description = ref('');
const ent = ref<any | null>(null);
const req = ref<any | null>(null); // 현재 요청(결과 포함)
const gate = ref<GateBlock | null>(null);
const busy = ref(false);
const netErr = ref('');
const history = ref<any[]>([]);
const pollTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const pollStarted = ref(0);
const picker = ref<InstanceType<typeof PhotoPicker> | null>(null);
let idemKey = newIdempotencyKey();

const analyzing = computed(() => req.value?.status === 'analyzing');
const result = computed(() => req.value?.result ?? null);
const g2 = computed(() => gate.value?.gate === 'G2' || (ent.value && !ent.value.eligible));

const entLine = computed(() => {
  const e = ent.value;
  if (!e) return '';
  const parts: string[] = [];
  if (e.freeTrial) parts.push(`무료 체험 ${e.freeTrial.remaining}회 남음 (총 ${e.freeTrial.total}회)`);
  else if (e.isGuest) parts.push('무료 체험');
  for (const p of e.paid ?? []) {
    if (!p.usable) continue;
    parts.push(p.kind === 'monthly' ? `월 구독 ${fmtDate(p.validUntil)}까지` : `건별 이용권 ${p.remaining}회`);
  }
  if (!parts.length) parts.push('사용할 수 있는 이용권이 없습니다');
  return parts.join(' · ');
});

const submitReason = computed(() => {
  if (!photos.value.length) return '하자 사진을 1장 이상 올려 주세요';
  return null;
});

async function loadEntitlements() {
  try {
    ent.value = await api('/api/me/entitlements', { handle401: true });
  } catch {
    ent.value = null;
  }
}
async function loadHistory() {
  if (!session.me || !session.can('analysis.read.own')) return;
  try {
    history.value = await get('/api/me/cases');
  } catch {
    history.value = [];
  }
}

async function openRequest(id: number) {
  stopPoll();
  gate.value = null;
  netErr.value = '';
  try {
    req.value = await get(`/api/analysis-requests/${id}`);
    gate.value = req.value.gate ?? null;
    if (req.value.status === 'analyzing') startPoll();
  } catch (e) {
    if (e instanceof GateBlockError) gate.value = e.block;
    else netErr.value = errorMessage(e);
  }
}

function startPoll() {
  pollStarted.value = Date.now();
  const tick = async () => {
    if (!req.value) return;
    try {
      const r = await get(`/api/analysis-requests/${req.value.requestId}`);
      req.value = r;
      if (r.status !== 'analyzing') {
        gate.value = r.gate ?? null;
        await loadEntitlements();
        await loadHistory();
        return;
      }
    } catch (e) {
      if (e instanceof NetworkError) netErr.value = errorMessage(e);
    }
    if (Date.now() - pollStarted.value < 75_000) pollTimer.value = setTimeout(tick, 2000);
  };
  pollTimer.value = setTimeout(tick, 1200);
}
function stopPoll() {
  if (pollTimer.value) clearTimeout(pollTimer.value);
  pollTimer.value = null;
}

async function submit() {
  if (busy.value || submitReason.value) return;
  busy.value = true;
  gate.value = null;
  netErr.value = '';
  const form = new FormData();
  for (const f of photos.value) form.append('photos', f, f.name);
  if (description.value.trim()) form.append('description', description.value.trim());
  if (route.query.caseId) form.append('caseId', String(route.query.caseId));
  try {
    const r = await api('/api/analysis-requests', { method: 'POST', form, idempotencyKey: idemKey });
    req.value = r;
    idemKey = newIdempotencyKey();
    clearDraft(DRAFT);
    photos.value = [];
    description.value = '';
    await session.refresh();
    router.replace({ query: { requestId: String(r.requestId) } });
    if (r.status === 'analyzing') startPoll();
    else gate.value = r.gate ?? null;
    await loadEntitlements();
  } catch (e) {
    idemKey = newIdempotencyKey();
    if (e instanceof GateBlockError) {
      gate.value = e.block;
      await loadEntitlements();
      if (e.block.gate === 'G3') {
        await nextTick();
        picker.value?.focus();
      }
      if (session.me === null) await session.refresh();
    } else netErr.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function retryAnalysis() {
  if (!req.value) return;
  busy.value = true;
  try {
    const r = await api(`/api/analysis-requests/${req.value.requestId}/retry`, {
      method: 'POST',
      body: {},
      idempotencyKey: newIdempotencyKey(),
    });
    req.value = r;
    gate.value = null;
    router.replace({ query: { requestId: String(r.requestId) } });
    startPoll();
  } catch (e) {
    if (e instanceof GateBlockError) gate.value = e.block;
    else netErr.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function onGateAction(a: { id: string }) {
  if (a.id === 'retry-upload') {
    gate.value = null;
    if (req.value?.status === 'quality_rejected') {
      router.replace({ query: { caseId: String(req.value.caseId) } });
      req.value = null;
    }
    nextTick(() => picker.value?.focus());
  } else if (a.id === 'retry-analysis') retryAnalysis();
}

function printResult() {
  window.print();
}

/** 오늘·어제·N일 전 — 날짜를 읽기 쉽게 */
function relDate(d?: string | null) {
  if (!d) return '';
  const day = d.slice(0, 10);
  const diff = Math.round(
    (new Date(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)).getTime() - new Date(day).getTime()) / 86400_000,
  );
  if (diff <= 0) return '오늘';
  if (diff === 1) return '어제';
  if (diff < 7) return `${diff}일 전`;
  return fmtDate(d);
}

function newAnalysis() {
  stopPoll();
  req.value = null;
  gate.value = null;
  router.replace({ query: {} });
}

// 초안 보존
watch(description, (v) => saveDraft(DRAFT, { description: v }));
watch(photos, (v) => saveDraftPhotos(DRAFT, v), { deep: false });

onMounted(async () => {
  const d = loadDraft<{ description: string }>(DRAFT);
  if (d?.description) description.value = d.description;
  const ph = await loadDraftPhotos(DRAFT);
  if (ph.length) photos.value = ph;
  await loadEntitlements();
  await loadHistory();
  if (route.query.requestId) await openRequest(Number(route.query.requestId));
});
onBeforeUnmount(stopPoll);

const rail = computed(() => req.value?.progress ?? null);
const statusLabel: Record<string, { tone: any; label: string }> = {
  completed: { tone: 'ok', label: '완료' },
  analyzing: { tone: 'info', label: '분석 중' },
  failed: { tone: 'danger', label: '분석 실패' },
  quality_rejected: { tone: 'danger', label: '품질 부적합' },
  received: { tone: 'info', label: '접수' },
};
</script>

<template>
  <div>
    <C1ProgressRail v-if="rail" variant="case" :title="`하자 건 ${rail.caseNo}`" :stages="rail.stages" />
    <div class="container page">
      <div class="page-head">
        <div>
          <p class="eyebrow">사진으로 하자 확인하기</p>
          <h1 class="display-md">하자 분석</h1>
          <p class="body-md muted" style="margin-top: 8px">사진 한 장으로 가능한 원인과 대응방안을 1차 참고용으로 확인합니다.</p>
        </div>
        <div class="ent" aria-live="polite">
          <StatusBadge :tone="ent?.eligible ? 'ok' : 'warn'" :label="ent?.eligible ? '분석 가능' : '이용권 없음'" />
          <span class="body-sm">{{ entLine }}</span>
        </div>
      </div>

      <RetryBox v-if="netErr" :message="netErr" keeps-input @retry="req ? openRequest(req.requestId) : submit()" />

      <!-- ===================================================== 결과 상태 -->
      <section v-if="req" class="result-wrap" aria-live="polite">
        <div class="row-between">
          <h2 class="title-lg">분석 결과 · {{ req.caseNo }}</h2>
          <BaseButton variant="secondary" size="sm" @click="newAnalysis">새 분석</BaseButton>
        </div>

        <div v-if="analyzing" class="analyzing panel-soft" role="status">
          <span class="spinner" aria-hidden="true"></span>
          <div>
            <p class="title-sm">분석 중입니다</p>
            <p class="body-sm">보통 1분 안에 끝납니다. 이 화면을 떠나도 결과는 이력에 남습니다.</p>
          </div>
        </div>

        <C2GateBlock v-if="gate" :block="gate" :busy-action="busy ? 'retry-analysis' : null" @action="onGateAction" />

        <article v-if="result" class="result-card">
          <div class="result-grid">
            <div class="photos">
              <PhotoThumb v-for="p in req.photos" :key="p.photoId" :photo="p" />
            </div>
            <div class="stack">
              <div class="row">
                <StatusBadge :tone="riskTone(result.riskLevel)" :label="`위험도 ${RISK_LABEL[result.riskLevel]}`" size="md" />
                <StatusBadge v-if="result.lowConfidence" tone="warn" label="신뢰도 낮음" size="md" />
                <StatusBadge tone="ref" label="1차 참고용" size="md" />
                <span class="caption">AI 신뢰도 {{ result.aiConfidence ?? '-' }} · {{ fmtDate(result.completedAt, true) }}</span>
              </div>
              <p v-if="req.description" class="body-sm muted">설명: {{ req.description }}</p>
              <div>
                <h3 class="title-md">가능한 원인</h3>
                <ol class="causes">
                  <li v-for="c in result.causes" :key="c.rank">
                    <span class="rank">{{ c.rank }}</span>
                    <span>{{ c.text }}</span>
                  </li>
                </ol>
              </div>
              <div>
                <h3 class="title-md">대응방안</h3>
                <ul class="actions">
                  <li v-for="a in result.actions" :key="a.seq">{{ a.text }}</li>
                </ul>
              </div>
            </div>
          </div>
          <C5RiskRecommendation
            v-if="result.recommendExpert || result.riskLevel !== 'normal'"
            :risk-level="result.riskLevel"
            :low-confidence="result.lowConfidence"
            :case-id="req.caseId"
            :has-building="!!req.buildingId"
            source="analysis"
          />
          <!-- FR-014: 고지는 결과 카드 안, 닫기·접기 없음 -->
          <C4ReferenceNotice :notice="result.notice" variant="analysis" />
        </article>

        <section v-if="result" class="next" aria-labelledby="next-title">
          <h3 id="next-title" class="title-md">다음에 이렇게 해 보세요</h3>
          <ul class="next-list">
            <li v-if="result.riskLevel === 'danger'">
              <b>지금</b> 위험 가능성이 있어요. 하자 부위 주변 사용을 줄이고, 건물 관리 담당자나 전문가에게 점검을 받아 보세요.
            </li>
            <li v-else-if="result.riskLevel === 'caution' || result.lowConfidence">
              <b>2~4주 안에</b> 같은 위치를 같은 각도로 다시 찍어 분석해 보세요. 변화가 있으면 전문가 점검을 권해요.
            </li>
            <li v-else><b>다음 점검 때</b> 같은 위치를 다시 찍어 변화가 없는지 확인해 보세요.</li>
            <li><b>기록</b> 결과는 "내 분석 이력"에 남아요. 같은 하자를 다시 찍으면 비교하기 쉬워요.</li>
          </ul>
          <div class="row">
            <BaseButton variant="secondary" size="sm" @click="newAnalysis">다른 하자 분석하기</BaseButton>
            <BaseButton variant="text" size="sm" @click="printResult">결과 인쇄·저장</BaseButton>
          </div>
        </section>
      </section>

      <!-- ===================================================== 입력 상태 -->
      <section v-else class="input-grid">
        <form class="stack-lg" @submit.prevent="submit">
          <C2GateBlock v-if="gate" :block="gate" @action="onGateAction" />
          <div class="field">
            <span class="field-label req">하자 사진</span>
            <PhotoPicker ref="picker" id="s2-photos" v-model="photos" :max="10" capture :invalid="gate?.gate === 'G3'" label="하자 사진" />
            <span class="hint">균열·누수·결로 부위가 화면 가운데 오도록, 밝은 곳에서 초점을 맞춰 찍어 주세요.</span>
          </div>
          <div class="field">
            <label for="s2-desc">간단한 설명 <span class="muted">(선택)</span></label>
            <textarea
              id="s2-desc"
              v-model="description"
              class="textarea"
              maxlength="500"
              placeholder="예: 비가 온 뒤 천장에서 물이 떨어져요"
            ></textarea>
            <span class="hint">{{ description.length }}/500</span>
          </div>
          <div class="submit-row">
            <C3ReasonedButton
              type="submit"
              block
              :busy="busy"
              :disabled="!!submitReason || g2"
              :gate="g2 ? 'G2' : null"
              :reason="submitReason"
            >
              분석 요청
            </C3ReasonedButton>
            <template v-if="g2 && !gate">
              <BaseButton v-if="session.loggedIn" variant="secondary" block :to="{ path: '/purchase', query: { returnTo: '/analysis' } }"
                >이용권 구매</BaseButton
              >
              <BaseButton v-else variant="secondary" block :to="{ path: '/login', query: { returnTo: '/purchase' } }"
                >로그인하고 이용권 구매</BaseButton
              >
            </template>
          </div>
          <p class="caption">분석 결과는 이미지 기반 1차 참고용 정보입니다. 품질 부적합·분석 실패는 이용권을 차감하지 않습니다.</p>
        </form>

        <aside class="side">
          <h2 class="title-lg">내 분석 이력</h2>
          <p v-if="!session.me || session.isGuest" class="body-sm muted">
            비회원 분석 결과는 이 기기에 보관됩니다.
            <RouterLink :to="{ path: '/login', query: { returnTo: '/analysis' } }">로그인</RouterLink>하면 계정에 연결할 수 있습니다.
          </p>
          <p v-else-if="!history.length" class="empty">아직 분석한 건이 없습니다</p>
          <ul v-else class="hist">
            <li v-for="h in history" :key="h.caseId">
              <button type="button" class="hist-item" :disabled="!h.lastRequestId" @click="h.lastRequestId && openRequest(h.lastRequestId)">
                <b class="title-sm hist-title">{{ h.description || h.topCause || '설명 없이 올린 사진' }}</b>
                <span class="row">
                  <StatusBadge v-if="h.riskLevel" :tone="riskTone(h.riskLevel)" :label="RISK_LABEL[h.riskLevel]" />
                  <StatusBadge
                    v-else-if="h.lastStatus"
                    :tone="statusLabel[h.lastStatus]?.tone ?? 'na'"
                    :label="statusLabel[h.lastStatus]?.label ?? h.lastStatus"
                  />
                </span>
                <span class="caption"
                  >{{ relDate(h.createdAt) }} · {{ h.caseNo }}<template v-if="h.buildingName"> · {{ h.buildingName }}</template></span
                >
              </button>
            </li>
          </ul>
        </aside>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ent {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--s-xxs);
  text-align: right;
}
.input-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--s-xl);
}
.submit-row {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  max-width: 420px;
}
.side {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.hist {
  border-top: 1px solid var(--hairline);
}
.hist-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  min-height: 64px;
  padding: var(--s-sm) 0;
  background: none;
  border: 0;
  border-bottom: 1px solid var(--hairline);
  text-align: left;
  cursor: pointer;
}
.hist-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.next {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  padding: var(--s-lg);
  background: var(--surface-soft);
}
.next-list {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  font: var(--t-body-sm);
}
.next-list b {
  margin-right: var(--s-xs);
  color: var(--ink);
}
.hist-item:disabled {
  cursor: default;
}
.result-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}
.analyzing {
  display: flex;
  gap: var(--s-md);
  align-items: center;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--hairline-strong);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  flex: none;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
.result-card {
  border: 1px solid var(--hairline);
  display: flex;
  flex-direction: column;
}
.result-card > :deep(.risk),
.result-card > :deep(.notice) {
  margin: 0;
}
.result-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: var(--s-lg);
  padding: var(--s-lg);
}
.photos {
  display: grid;
  gap: var(--s-xs);
  grid-template-columns: 1fr;
  align-content: start;
}
.causes {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  margin-top: var(--s-xs);
}
.causes li {
  display: flex;
  gap: var(--s-sm);
  align-items: baseline;
  font: var(--t-body-md);
}
.rank {
  flex: none;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  background: var(--ink);
  color: var(--on-dark);
  font: var(--t-label);
}
.actions {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  margin-top: var(--s-xs);
}
.actions li {
  font: var(--t-body-md);
  padding-left: var(--s-md);
  position: relative;
}
.actions li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 11px;
  width: 8px;
  height: 2px;
  background: var(--primary);
}
@media (max-width: 1023px) {
  .input-grid,
  .result-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .ent {
    align-items: flex-start;
    text-align: left;
  }
  .submit-row {
    max-width: none;
  }
}
@media (max-width: 767px) {
  .result-grid {
    padding: var(--s-md);
  }
}
</style>
