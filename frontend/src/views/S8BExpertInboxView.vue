<script setup lang="ts">
/**
 * S8B 점검 요청 수락 (UC7 · P8 8.5 · SD_02 §11 · 전문가)
 * 목록(응답 대기 먼저, 응답 시한) → 상세: 동의된 범위의 자료만(FR-084) + 공유 범위·확정 전 고지 판본
 * [수락] → 연결 확정·수수료 기록 · [거절] → 사유(선택, 화면 안). 응답한 요청은 읽기 전용.
 * 연락처는 연결 확정 뒤에만(서버 제공).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get, api, GateBlockError, ApiError, newIdempotencyKey, errorMessage, type GateBlock } from '@/api/client';
import { useGates } from '@/stores/gates';
import { fmtDate } from '@/composables/useCan';
import { attemptResponse, fmtDateTime, feeText } from '@/components/expert/expertLabels';
import C2GateBlock from '@/components/common/C2GateBlock.vue';
import C4ReferenceNotice from '@/components/common/C4ReferenceNotice.vue';
import C6CaseSummary from '@/components/common/C6CaseSummary.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import RetryBox from '@/components/base/RetryBox.vue';
import AlertBox from '@/components/base/AlertBox.vue';

const route = useRoute();
const router = useRouter();
const gates = useGates();

const list = ref<any[]>([]);
const listLoading = ref(true);
const listErr = ref('');
const pageGate = ref<GateBlock | null>(null);

const detail = ref<any | null>(null);
const detailLoading = ref(false);
const detailErr = ref('');

const declining = ref(false);
const declineReason = ref('');
const busy = ref<'accepted' | 'declined' | null>(null);
const respondErr = ref('');
const respondInfo = ref('');
const respondGate = ref<GateBlock | null>(null);
let respondKey = newIdempotencyKey();

const attemptId = computed(() => (route.query.attemptId ? Number(route.query.attemptId) : null));
const pending = computed(() => !!detail.value && !detail.value.response);
const pendingCount = computed(() => list.value.filter((a) => !a.response).length);

/** G10 연결 상태 — 문구는 gate_def 단일 원천, S8A 와 같은 문구 */
const g10 = computed<GateBlock>(() => ({
  gate: 'G10',
  message: gates.messageOf('G10'),
  reason: '수락하면 연결이 확정되고 연결 수수료가 기록됩니다. 거절·무응답에는 수수료가 없습니다.',
  releaseParty: gates.releasePartyOf('G10'),
  selfRelease: true,
  actions: [],
}));

function itemStatus(a: any) {
  if (a.connected) return { tone: 'ok' as const, label: '연결 확정' };
  return attemptResponse(a.response);
}
function overdue(respondBy: string | null) {
  return !!respondBy && new Date(respondBy).getTime() < Date.now();
}

async function loadList() {
  listLoading.value = true;
  listErr.value = '';
  try {
    list.value = await get('/api/me/expert-attempts');
    if (!attemptId.value && list.value.length) {
      const first = list.value.find((a) => !a.response) ?? list.value[0];
      router.replace({ query: { attemptId: String(first.attemptId) } });
    }
  } catch (e) {
    if (e instanceof GateBlockError) pageGate.value = e.block;
    else listErr.value = errorMessage(e);
  } finally {
    listLoading.value = false;
  }
}

async function loadDetail() {
  if (!attemptId.value) {
    detail.value = null;
    return;
  }
  detailLoading.value = true;
  detailErr.value = '';
  declining.value = false;
  declineReason.value = '';
  respondErr.value = '';
  respondInfo.value = '';
  respondGate.value = null;
  respondKey = newIdempotencyKey();
  try {
    detail.value = await get(`/api/expert-attempts/${attemptId.value}`);
  } catch (e) {
    detail.value = null;
    if (e instanceof GateBlockError) pageGate.value = e.block;
    else detailErr.value = errorMessage(e);
  } finally {
    detailLoading.value = false;
  }
}

function open(id: number) {
  if (id === attemptId.value) return;
  router.replace({ query: { attemptId: String(id) } });
  nextTick(() => {
    if (window.matchMedia('(max-width: 1023px)').matches)
      document.getElementById('s8b-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

async function respond(response: 'accepted' | 'declined') {
  if (busy.value || !detail.value) return;
  busy.value = response;
  respondErr.value = '';
  respondGate.value = null;
  try {
    detail.value = await api(`/api/expert-attempts/${detail.value.attemptId}/respond`, {
      method: 'POST',
      body: { response, declineReason: response === 'declined' ? declineReason.value.trim() || null : null },
      idempotencyKey: respondKey,
    });
    respondKey = newIdempotencyKey();
    declining.value = false;
    await loadList();
    await nextTick();
    document.getElementById('s8b-result')?.focus();
  } catch (e) {
    if (e instanceof GateBlockError) respondGate.value = e.block;
    else if (e instanceof ApiError && e.code === 'already_responded') {
      respondInfo.value = e.message;
      respondKey = newIdempotencyKey();
      const id = detail.value.attemptId;
      detail.value = await get(`/api/expert-attempts/${id}`).catch(() => detail.value);
      await loadList();
    } else respondErr.value = errorMessage(e);
  } finally {
    busy.value = null;
  }
}

function startDecline() {
  declining.value = true;
  nextTick(() => document.getElementById('s8b-decline')?.focus());
}

watch(attemptId, loadDetail);
onMounted(async () => {
  await loadList();
  if (attemptId.value) await loadDetail();
});
</script>

<template>
  <div class="container page">
    <div class="page-head">
      <div>
        <p class="eyebrow">전문가 업무</p>
        <h1 class="display-md">점검 요청</h1>
        <p class="body-md muted" style="margin-top: 8px">
          건물관리자가 동의한 범위의 자료만 보입니다. 수락하면 연결이 확정되고 서로의 연락처가 공개됩니다.
        </p>
      </div>
      <StatusBadge :tone="pendingCount ? 'info' : 'na'" :label="`응답 대기 ${pendingCount}`" size="md" />
    </div>

    <C2GateBlock v-if="pageGate" :block="pageGate" />

    <div class="layout">
      <!-- ===================================================== 목록 -->
      <section class="stack" aria-labelledby="s8b-list">
        <h2 id="s8b-list" class="title-lg">받은 요청</h2>
        <RetryBox v-if="listErr" :message="listErr" @retry="loadList" />
        <p v-else-if="listLoading" class="empty" role="status">불러오는 중</p>
        <p v-else-if="!list.length" class="empty">받은 점검 요청이 없습니다</p>
        <ul v-else class="items">
          <li v-for="a in list" :key="a.attemptId">
            <button type="button" class="item" :aria-current="a.attemptId === attemptId ? 'true' : undefined" @click="open(a.attemptId)">
              <span class="row">
                <b class="title-sm">{{ a.caseNo }}</b>
                <StatusBadge :tone="itemStatus(a).tone" :label="itemStatus(a).label" />
              </span>
              <span class="body-sm">{{ a.buildingName }} · {{ a.specialtyName }}</span>
              <span class="caption">희망 {{ fmtDate(a.wishFrom) }} ~ {{ fmtDate(a.wishTo) }}</span>
              <span v-if="!a.response && a.respondBy" class="caption" :class="{ late: overdue(a.respondBy) }">
                응답 기한 {{ fmtDateTime(a.respondBy) }}<template v-if="overdue(a.respondBy)"> (지남)</template>
              </span>
              <span v-else-if="a.respondedAt" class="caption">응답 {{ fmtDateTime(a.respondedAt) }}</span>
            </button>
          </li>
        </ul>
      </section>

      <!-- ===================================================== 상세 -->
      <section id="s8b-detail" class="stack-lg detail" aria-labelledby="s8b-detail-title">
        <RetryBox v-if="detailErr" :message="detailErr" @retry="loadDetail" />
        <p v-else-if="detailLoading" class="empty" role="status">불러오는 중</p>
        <p v-else-if="!detail" class="empty">왼쪽 목록에서 요청을 선택하세요</p>
        <template v-else>
          <div class="m-stripe" aria-hidden="true"></div>
          <div class="row-between">
            <h2 id="s8b-detail-title" class="title-lg">점검 요청 · {{ detail.shared?.caseNo }}</h2>
            <StatusBadge
              :tone="detail.connection ? 'ok' : attemptResponse(detail.response).tone"
              :label="detail.connection ? '연결 확정' : attemptResponse(detail.response).label"
              size="md"
            />
          </div>

          <dl class="dl">
            <dt>전문 분야</dt>
            <dd>{{ detail.specialtyName }}</dd>
            <dt>희망 기간</dt>
            <dd>{{ fmtDate(detail.wishFrom) }} ~ {{ fmtDate(detail.wishTo) }}</dd>
            <dt>건물</dt>
            <dd>
              {{ detail.shared?.building?.buildingName ?? '-'
              }}<template v-if="detail.shared?.building?.buildingTypeName"> · {{ detail.shared.building.buildingTypeName }}</template>
            </dd>
            <dt>받은 시각</dt>
            <dd>{{ fmtDateTime(detail.sentAt) }}</dd>
            <template v-if="!detail.response && detail.respondBy">
              <dt>응답 기한</dt>
              <dd :class="{ late: overdue(detail.respondBy) }">
                {{ fmtDateTime(detail.respondBy) }}<template v-if="overdue(detail.respondBy)"> (지남)</template>
              </dd>
            </template>
            <template v-if="detail.respondedAt">
              <dt>응답 시각</dt>
              <dd>{{ fmtDateTime(detail.respondedAt) }}</dd>
            </template>
            <template v-if="detail.response === 'declined'">
              <dt>거절 사유</dt>
              <dd>{{ detail.declineReason || '사유 없음' }}</dd>
            </template>
          </dl>

          <!-- 공유 범위 + 당시 고지 판본 -->
          <C4ReferenceNotice :notice="detail.shareNotice" variant="share">
            <p class="body-sm scope"><b>공유 범위</b> {{ detail.scopeText }}</p>
          </C4ReferenceNotice>

          <!-- 동의된 범위의 자료만 (사진·설명·AI 결과(고지 포함)·현장 기록·건물명/유형) -->
          <div v-if="detail.shared" class="stack">
            <h3 class="title-md">공유된 자료</h3>
            <C6CaseSummary :summary="detail.shared" variant="collapsed" />
          </div>
          <p v-else class="empty">공유된 자료를 불러오지 못했습니다</p>

          <!-- 결과 / 응답 -->
          <div v-if="detail.connection" id="s8b-result" class="panel-soft connected" tabindex="-1">
            <div class="row">
              <StatusBadge tone="ok" label="연결 확정" size="md" />
              <span class="title-sm">요청자와 연결되었습니다</span>
            </div>
            <dl class="dl">
              <dt>확정 시각</dt>
              <dd>{{ fmtDateTime(detail.connection.confirmedAt) }}</dd>
              <dt>연결 수수료</dt>
              <dd>{{ feeText(detail.connection.feeAmount) }}</dd>
              <template v-if="detail.contact">
                <dt>요청자</dt>
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
          </div>
          <div v-else-if="detail.response" id="s8b-result" tabindex="-1">
            <AlertBox
              :tone="detail.response === 'declined' ? 'warn' : 'info'"
              :title="detail.response === 'declined' ? '거절한 요청입니다' : '응답 시한이 지나 무응답으로 처리된 요청입니다'"
            >
              이 요청은 읽기 전용입니다. 요청자는 다른 후보에게 요청할 수 있습니다.
            </AlertBox>
          </div>

          <template v-if="pending">
            <AlertBox v-if="respondInfo" tone="info" title="이미 처리된 요청입니다">{{ respondInfo }}</AlertBox>
            <C2GateBlock :block="respondGate ?? g10" />
            <RetryBox
              v-if="respondErr"
              :message="respondErr"
              :keeps-input="declining"
              @retry="respond(declining ? 'declined' : 'accepted')"
            />

            <div v-if="declining" class="decline stack">
              <div class="field">
                <label for="s8b-decline">거절 사유 <span class="muted">(선택)</span></label>
                <textarea
                  id="s8b-decline"
                  v-model="declineReason"
                  class="textarea"
                  maxlength="200"
                  placeholder="예: 해당 기간 현장 일정이 이미 차 있습니다"
                ></textarea>
                <span class="hint">{{ declineReason.length }}/200 · 사유는 요청자에게 전달됩니다</span>
              </div>
              <div class="actions">
                <BaseButton :busy="busy === 'declined'" :disabled="!!busy" @click="respond('declined')">거절 보내기</BaseButton>
                <BaseButton variant="secondary" :disabled="!!busy" @click="declining = false">취소</BaseButton>
              </div>
            </div>
            <div v-else class="sticky-actions actions">
              <BaseButton :busy="busy === 'accepted'" :disabled="!!busy" @click="respond('accepted')">수락</BaseButton>
              <BaseButton variant="secondary" :disabled="!!busy" @click="startDecline">거절</BaseButton>
            </div>
          </template>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--s-xl);
  align-items: start;
}
.items {
  border-top: 1px solid var(--hairline);
}
.item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  min-height: 64px;
  padding: var(--s-sm) var(--s-xs);
  background: none;
  border: 0;
  border-bottom: 1px solid var(--hairline);
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.item[aria-current='true'] {
  background: var(--surface-soft);
  border-left: 2px solid var(--primary);
}
.item:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: -2px;
}
.late {
  color: var(--error-text);
}
.detail {
  min-width: 0;
}
.dl dd {
  overflow-wrap: anywhere;
}
.scope {
  margin-top: var(--s-xs);
  overflow-wrap: anywhere;
}
.connected {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
}
#s8b-result:focus {
  outline: none;
}
@media (max-width: 1023px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 767px) {
  .dl {
    grid-template-columns: minmax(0, 1fr);
  }
  .dl dt {
    margin-top: var(--s-xs);
  }
}
</style>
