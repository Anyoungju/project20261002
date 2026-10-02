<script setup lang="ts">
/**
 * S1 분석 이용권 구매 (UC2 · P1 · SD_02 §4)
 * - 무료 체험 상태 + 두 요금제(금액·이용 조건)를 결제 버튼보다 먼저 보인다 (FR-020 · U6)
 * - 결제 승인 뒤에만 이용권 부여(FR-021). 거절은 G1 C2 블록 → [결제 정보 바꿔 다시 시도] = 새 결제 생성
 * - [분석 계속하기] 는 이용권이 생기기 전까지 C3 비활성 → returnTo 로 복귀 (FR-023, S2 가 자기 초안 복원)
 * - 결제 단계는 모의 PG(시연용). 카드 번호는 서버로만 보내고 이 기기에 저장하지 않는다
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, get, post, GateBlockError, ApiError, newIdempotencyKey, errorMessage, type GateBlock } from '@/api/client';
import { useSession } from '@/stores/session';
import { useGates } from '@/stores/gates';
import { fmtDate, fmtMoney } from '@/composables/useCan';
import C2GateBlock from '@/components/common/C2GateBlock.vue';
import C3ReasonedButton from '@/components/common/C3ReasonedButton.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import OptionTile from '@/components/base/OptionTile.vue';
import AlertBox from '@/components/base/AlertBox.vue';
import RetryBox from '@/components/base/RetryBox.vue';
import GuestLinkPrompt from '@/components/auth/GuestLinkPrompt.vue';

interface Plan {
  planCode: 'per_analysis' | 'monthly';
  planName: string;
  priceAmount: number | null;
  analysisQuota: number | null;
  periodMonths: number | null;
  purchasable: boolean;
  conditionText: string;
}
interface Payment {
  paymentId: number;
  planCode: string;
  amount: number | null;
  status: 'requested' | 'approved' | 'declined' | string;
  declineReason: string | null;
  requestedAt: string;
  decidedAt?: string | null;
  entitlement?: { entitlementId: number; kind: string; quotaTotal: number | null; validUntil: string | null } | null;
}

const route = useRoute();
const router = useRouter();
const session = useSession();
const gates = useGates();

const plans = ref<Plan[]>([]);
const ent = ref<any | null>(null);
const history = ref<Payment[]>([]);
const loadErr = ref('');
const loading = ref(true);
const selected = ref<Plan['planCode']>('per_analysis');
const card = ref('');
const cardInput = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const payErr = ref('');
const gate = ref<GateBlock | null>(null); // G1
const approved = ref<Payment | null>(null);
const showLink = ref(session.guestLinkable);

/** 결제 1건 = 이용권 최대 1건(FR-022). 확인 단계에서 네트워크 오류면 같은 결제를 다시 확인한다 */
let pending: { paymentId: number; planCode: string } | null = null;
let createKey = newIdempotencyKey();
let confirmKey = newIdempotencyKey();

const returnTo = computed(() => {
  const r = typeof route.query.returnTo === 'string' ? route.query.returnTo : '';
  return r.startsWith('/') && !r.startsWith('//') ? r : '/analysis';
});

const plan = computed(() => plans.value.find((p) => p.planCode === selected.value) ?? null);
const cardDigits = computed(() => card.value.replace(/\D/g, ''));

const payReason = computed(() => {
  if (!plan.value) return '요금제를 선택해 주세요';
  if (!plan.value.purchasable || plan.value.priceAmount == null)
    return '요금 미설정 - 이 요금제는 아직 금액이 설정되지 않아 구매할 수 없습니다';
  if (cardDigits.value.length !== 16) return '카드 번호 16자리를 입력해 주세요';
  return null;
});

/** 진입 사유(G2) — 판정은 서버(v_analysis_eligibility → eligible). 문구는 gate_def */
const g2Block = computed<GateBlock | null>(() => {
  if (!ent.value || ent.value.eligible || gate.value || approved.value) return null;
  return {
    gate: 'G2',
    message: gates.messageOf('G2') || '분석 이용권이 없습니다',
    releaseParty: gates.releasePartyOf('G2') || '본인',
    selfRelease: true,
    actions: [],
  };
});

const usablePaid = computed(() => (ent.value?.paid ?? []).filter((p: any) => p.usable));

const continueGate = computed(() => {
  if (ent.value?.eligible) return null;
  return gate.value ? 'G1' : 'G2';
});

const PAY_STATUS: Record<string, { tone: 'ok' | 'danger' | 'info' | 'na'; label: string }> = {
  approved: { tone: 'ok', label: '승인' },
  declined: { tone: 'danger', label: '거절' },
  requested: { tone: 'info', label: '처리 중' },
};
const planName = (code: string) => plans.value.find((p) => p.planCode === code)?.planName ?? code;

function onCardInput(e: Event) {
  const d = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 16);
  card.value = d.replace(/(\d{4})(?=\d)/g, '$1-');
}
function fillCard(n: string) {
  card.value = n;
  cardInput.value?.focus();
}

async function loadEntitlements() {
  ent.value = await api('/api/me/entitlements', { handle401: true });
}
async function loadHistory() {
  try {
    history.value = await get<Payment[]>('/api/payments');
  } catch {
    history.value = [];
  }
}
async function load() {
  loading.value = true;
  loadErr.value = '';
  try {
    const [p] = await Promise.all([get<Plan[]>('/api/plans'), loadEntitlements()]);
    plans.value = p;
    const q = route.query.plan;
    if (q === 'monthly' || q === 'per_analysis') selected.value = q;
    else if (!p.find((x) => x.planCode === selected.value)?.purchasable)
      selected.value = p.find((x) => x.purchasable)?.planCode ?? selected.value;
    await loadHistory();
  } catch (e) {
    loadErr.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

async function pay() {
  if (busy.value || payReason.value || !plan.value) return;
  busy.value = true;
  payErr.value = '';
  try {
    if (!pending || pending.planCode !== plan.value.planCode) {
      const r = await post<{ paymentId: number; planCode: string }>(
        '/api/payments',
        { planCode: plan.value.planCode },
        { idempotencyKey: createKey },
      );
      pending = { paymentId: r.paymentId, planCode: r.planCode };
      createKey = newIdempotencyKey();
      confirmKey = newIdempotencyKey();
    }
    const dto = await post<Payment>(
      `/api/payments/${pending.paymentId}/confirm`,
      { cardNumber: cardDigits.value },
      { idempotencyKey: confirmKey },
    );
    pending = null;
    confirmKey = newIdempotencyKey();
    card.value = '';
    if (dto.status === 'approved') {
      gate.value = null;
      approved.value = dto;
    } else {
      payErr.value = '결제 결과를 확인하지 못했습니다 - 결제 내역에서 상태를 확인해 주세요';
    }
    await Promise.all([loadEntitlements().catch(() => undefined), loadHistory()]);
  } catch (e) {
    if (e instanceof GateBlockError) {
      // G1 거절 — 이 결제는 끝났다. 다시 시도는 새 결제로
      pending = null;
      confirmKey = newIdempotencyKey();
      card.value = '';
      approved.value = null;
      gate.value = e.block;
      await loadHistory();
    } else if (e instanceof ApiError && e.status !== 409) {
      // 서버가 결제를 거부(요금 미설정 등) — 새로 시작
      pending = null;
      createKey = newIdempotencyKey();
      payErr.value = errorMessage(e);
      if (e.code === 'plan_price_unset') await load();
    } else {
      // 네트워크·처리 중 — 같은 키로 다시 시도하면 중복 결제가 생기지 않는다
      payErr.value = errorMessage(e);
    }
  } finally {
    busy.value = false;
  }
}

function onGateAction(a: { id: string }) {
  if (a.id === 'retry-payment') {
    card.value = '';
    nextTick(() => cardInput.value?.focus());
  }
}

function continueAnalysis() {
  router.push(returnTo.value);
}

onMounted(load);
</script>

<template>
  <div class="container page">
    <div class="page-head">
      <div>
        <p class="eyebrow">분석 이용권</p>
        <h1 class="display-md">분석 이용권 구매</h1>
        <p class="body-md muted" style="margin-top: 8px">요금제를 고르고 결제하면 바로 분석을 이어갈 수 있습니다.</p>
      </div>
      <p v-if="session.me" class="caption">계정 {{ session.me.emailMasked }}</p>
    </div>

    <GuestLinkPrompt
      v-if="showLink"
      class="block-gap"
      @done="
        showLink = false;
        loadEntitlements().catch(() => undefined);
      "
    />

    <RetryBox v-if="loadErr" :message="loadErr" :busy="loading" @retry="load" />

    <template v-else-if="loading">
      <div class="skeleton" style="height: 96px"></div>
      <div class="grid-2 block-gap">
        <div class="skeleton" style="height: 160px"></div>
        <div class="skeleton" style="height: 160px"></div>
      </div>
    </template>

    <template v-else>
      <!-- 진입 사유 G2 (S2 와 같은 문구) -->
      <C2GateBlock v-if="g2Block" :block="g2Block" />

      <!-- 현재 이용 상태 -->
      <section class="status panel-soft" aria-labelledby="s1-status">
        <h2 id="s1-status" class="title-md">현재 이용 상태</h2>
        <ul class="status-list">
          <li>
            <span class="body-sm">무료 체험</span>
            <template v-if="ent?.freeTrial">
              <StatusBadge
                :tone="ent.freeTrial.remaining > 0 ? 'ok' : 'na'"
                :label="ent.freeTrial.remaining > 0 ? `${ent.freeTrial.remaining}회 남음` : '모두 사용'"
              />
              <span class="caption">총 {{ ent.freeTrial.total }}회 중 {{ ent.freeTrial.used }}회 사용</span>
            </template>
            <span v-else class="caption">해당 없음</span>
          </li>
          <li v-for="p in usablePaid" :key="p.entitlementId">
            <span class="body-sm">{{ p.kind === 'monthly' ? '월 구독' : '건별 이용권' }}</span>
            <StatusBadge tone="ok" :label="p.kind === 'monthly' ? `${fmtDate(p.validUntil)}까지` : `${p.remaining}회 남음`" />
          </li>
          <li v-if="!usablePaid.length && !(ent?.freeTrial?.remaining > 0)">
            <span class="body-sm">유료 이용권</span>
            <StatusBadge tone="na" label="없음" />
          </li>
        </ul>
      </section>

      <div class="buy-grid">
        <div class="stack-lg">
          <!-- 요금제 선택 -->
          <fieldset class="plans">
            <legend class="title-lg">요금제 선택</legend>
            <div class="grid-2">
              <OptionTile
                v-for="p in plans"
                :key="p.planCode"
                name="s1-plan"
                :value="p.planCode"
                :title="p.planName"
                :selected="selected === p.planCode"
                @select="(v: string) => (selected = v as Plan['planCode'])"
              >
                <span class="price" :class="{ unset: p.priceAmount == null }">{{
                  p.priceAmount == null ? '요금 미설정' : fmtMoney(p.priceAmount)
                }}</span>
                <span>{{ p.conditionText }}</span>
              </OptionTile>
            </div>
          </fieldset>

          <!-- 선택한 요금제 → 결제 -->
          <section v-if="plan" class="checkout" aria-labelledby="s1-sel">
            <div class="sel-head">
              <h2 id="s1-sel" class="title-lg">선택한 요금제</h2>
              <dl class="dl">
                <dt>요금제</dt>
                <dd>{{ plan.planName }}</dd>
                <dt>결제 금액</dt>
                <dd class="amount">{{ plan.priceAmount == null ? '요금 미설정' : fmtMoney(plan.priceAmount) }}</dd>
                <dt>이용 조건</dt>
                <dd>{{ plan.conditionText }}</dd>
              </dl>
            </div>

            <form class="pay stack" @submit.prevent="pay">
              <div class="mock-head">
                <StatusBadge tone="ref" label="시연용 결제(모의)" />
                <span class="caption">실제 결제가 일어나지 않습니다</span>
              </div>
              <div class="field">
                <label for="s1-card">카드 번호</label>
                <input
                  id="s1-card"
                  ref="cardInput"
                  class="input mono"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  placeholder="0000-0000-0000-0000"
                  maxlength="19"
                  :value="card"
                  :disabled="plan.priceAmount == null"
                  :aria-invalid="gate ? 'true' : undefined"
                  aria-describedby="s1-card-hint"
                  @input="onCardInput"
                />
                <div id="s1-card-hint" class="hint">
                  <p>시연용 카드 번호</p>
                  <ul class="cards">
                    <li>
                      <button type="button" class="card-fill mono" @click="fillCard('4242-4242-4242-4242')">4242-4242-4242-4242</button>
                      승인 (그 밖의 16자리도 승인)
                    </li>
                    <li>
                      <button type="button" class="card-fill mono" @click="fillCard('4000-0000-0000-0002')">4000-0000-0000-0002</button>
                      거절 - 한도 초과
                    </li>
                    <li>
                      <button type="button" class="card-fill mono" @click="fillCard('4000-0000-0000-0069')">4000-0000-0000-0069</button>
                      거절 - 카드사 거절
                    </li>
                  </ul>
                </div>
              </div>

              <C2GateBlock v-if="gate" :block="gate" @action="onGateAction" />
              <RetryBox v-if="payErr" :message="payErr" :busy="busy" @retry="pay" />

              <C3ReasonedButton type="submit" block :busy="busy" :disabled="!!payReason" :reason="payReason">
                {{ plan.priceAmount == null ? '결제하기' : `${fmtMoney(plan.priceAmount)} 결제하기` }}
              </C3ReasonedButton>
            </form>
          </section>

          <AlertBox v-if="approved" tone="ok" title="결제가 승인되어 이용권이 부여되었습니다">
            {{ planName(approved.planCode) }} · {{ fmtMoney(approved.amount) }}
            <template v-if="approved.entitlement?.kind === 'monthly'"> · {{ fmtDate(approved.entitlement.validUntil) }}까지</template>
            <template v-else-if="approved.entitlement"> · 분석 {{ approved.entitlement.quotaTotal }}회</template>
          </AlertBox>

          <div class="continue">
            <C3ReasonedButton
              :variant="approved || ent?.eligible ? 'primary' : 'secondary'"
              block
              :disabled="!!continueGate"
              :gate="continueGate"
              @click="continueAnalysis"
            >
              분석 계속하기
            </C3ReasonedButton>
            <p class="caption">분석 화면으로 돌아가면 올려 둔 사진과 설명이 그대로 남아 있습니다.</p>
          </div>
        </div>

        <aside class="side" aria-labelledby="s1-hist">
          <h2 id="s1-hist" class="title-lg">결제 내역</h2>
          <p v-if="!history.length" class="empty">결제 내역이 없습니다</p>
          <ul v-else class="hist">
            <li v-for="h in history" :key="h.paymentId">
              <span class="row">
                <b class="title-sm">{{ planName(h.planCode) }}</b>
                <StatusBadge :tone="PAY_STATUS[h.status]?.tone ?? 'na'" :label="PAY_STATUS[h.status]?.label ?? h.status" />
              </span>
              <span class="caption">{{ fmtDate(h.requestedAt, true) }} · {{ fmtMoney(h.amount) }}</span>
              <span v-if="h.declineReason" class="body-sm">사유: {{ h.declineReason }}</span>
            </li>
          </ul>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.block-gap {
  margin-bottom: var(--s-lg);
}
.status {
  margin-bottom: var(--s-xl);
}
.status-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-sm) var(--s-xl);
  margin-top: var(--s-sm);
}
.status-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-xs);
}
.buy-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--s-xl);
}
.plans {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.plans legend {
  padding: 0;
  margin-bottom: var(--s-md);
}
.price {
  font: var(--t-display-sm);
  color: var(--ink);
}
.price.unset {
  font: var(--t-title-md);
  color: var(--muted);
}
.checkout {
  border: 1px solid var(--hairline);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.sel-head {
  padding: var(--s-lg);
  background: var(--surface-soft);
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}
.amount {
  font: var(--t-title-lg);
  color: var(--ink);
}
.pay {
  padding: var(--s-lg);
}
.mock-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-xs);
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--s-xxs);
}
.cards li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-xs);
}
.card-fill {
  min-height: 40px;
  padding: 0 var(--s-xs);
  border: 1px solid var(--hairline-strong);
  background: var(--canvas);
  color: var(--ink);
  font-size: 12px;
  cursor: pointer;
}
@media (pointer: coarse) {
  .card-fill {
    min-height: var(--touch);
  }
}
.continue {
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
.hist li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--s-sm) 0;
  border-bottom: 1px solid var(--hairline);
}
@media (max-width: 1023px) {
  .buy-grid,
  .checkout {
    grid-template-columns: minmax(0, 1fr);
  }
  .continue {
    max-width: none;
  }
}
@media (max-width: 767px) {
  .sel-head,
  .pay {
    padding: var(--s-md);
  }
}
</style>
