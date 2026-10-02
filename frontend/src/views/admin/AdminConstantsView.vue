<script setup lang="ts">
/**
 * 관리 · 기준값·고지 — 운영 기준값(service_constant) · 요금(service_plan) · 고지 판본(notice_text).
 * NULL 기준값 = 미설정 → 서버가 보수적으로 동작한다(예: 요금 미설정이면 결제 불가).
 * 고지 변경은 새 판본 추가만(FR-018) — 과거 결과는 당시 판본을 유지한다.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { get, post, put } from '@/api/client';
import { useSession } from '@/stores/session';
import { fmtDate, fmtMoney } from '@/composables/useCan';
import BaseButton from '@/components/base/BaseButton.vue';
import CategoryTabs from '@/components/base/CategoryTabs.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import ActionError from '@/components/admin/ActionError.vue';
import InlineConfirm from '@/components/admin/InlineConfirm.vue';
import { NOTICE_KIND_LABEL } from '@/components/admin/adminLabels';

interface Constant {
  key: string;
  value: string | null;
  unit: string | null;
  description: string | null;
}
/** GET /api/admin/constants 의 plans 는 DB 열 이름 그대로 온다 */
interface PlanRow {
  plan_code: string;
  plan_name: string;
  price_amount: number | string | null;
  analysis_quota: number | null;
  period_months: number | null;
}
interface Notice {
  noticeId: number;
  kind: string;
  body: string;
  effectiveFrom: string;
}

const session = useSession();
const canNotices = computed(() => session.can('admin.notices.manage'));

const tab = ref('constants');
const tabs = computed(() => [
  { value: 'constants', label: '운영 기준값' },
  { value: 'plans', label: '요금' },
  ...(canNotices.value ? [{ value: 'notices', label: '고지 판본' }] : []),
]);

const constants = ref<Constant[]>([]);
const plans = ref<PlanRow[]>([]);
const loading = ref(false);
const loadErr = ref<unknown>(null);

const cEdit = reactive<Record<string, string>>({});
const pEdit = reactive<Record<string, string>>({});
const rowBusy = ref<string | null>(null);
const rowErr = reactive<Record<string, { error: unknown; retry: () => void }>>({});
const rowSaved = ref<string | null>(null);

async function load() {
  loading.value = true;
  loadErr.value = null;
  try {
    const r = await get<{ constants: Constant[]; plans: PlanRow[] }>('/api/admin/constants');
    constants.value = r.constants;
    plans.value = r.plans;
    for (const c of r.constants) cEdit[c.key] = c.value ?? '';
    for (const p of r.plans) pEdit[p.plan_code] = p.price_amount == null ? '' : String(Number(p.price_amount));
  } catch (e) {
    loadErr.value = e;
  } finally {
    loading.value = false;
  }
}

async function saveConstant(c: Constant, value: string | null) {
  const id = `c:${c.key}`;
  rowBusy.value = id;
  delete rowErr[id];
  rowSaved.value = null;
  try {
    const r = await put<Constant>(`/api/admin/constants/${encodeURIComponent(c.key)}`, {
      value: value == null || value.trim() === '' ? null : value.trim(),
    });
    const i = constants.value.findIndex((x) => x.key === c.key);
    if (i >= 0 && r) constants.value[i] = r;
    cEdit[c.key] = r?.value ?? '';
    rowSaved.value = id;
  } catch (e) {
    rowErr[id] = { error: e, retry: () => saveConstant(c, value) };
  } finally {
    rowBusy.value = null;
  }
}

const priceInvalid = (code: string) => pEdit[code] !== '' && !/^\d+$/.test(pEdit[code] ?? '');

async function savePrice(p: PlanRow, value: string | null) {
  const id = `p:${p.plan_code}`;
  rowBusy.value = id;
  delete rowErr[id];
  rowSaved.value = null;
  try {
    plans.value = await put<PlanRow[]>(`/api/admin/plans/${p.plan_code}/price`, {
      priceAmount: value == null || value === '' ? null : Number(value),
    });
    for (const x of plans.value) pEdit[x.plan_code] = x.price_amount == null ? '' : String(Number(x.price_amount));
    rowSaved.value = id;
  } catch (e) {
    rowErr[id] = { error: e, retry: () => savePrice(p, value) };
  } finally {
    rowBusy.value = null;
  }
}

// ------------------------------------------------------------ 고지 판본
const notices = ref<Notice[]>([]);
const nLoading = ref(false);
const nErr = ref<unknown>(null);
const nForm = reactive({ kind: 'analysis', body: '' });
const nBusy = ref(false);
const nSaveErr = ref<unknown>(null);
const nAdded = ref<number | null>(null);
const NOTICE_KINDS = ['analysis', 'priority', 'share'];

const byKind = computed(() =>
  NOTICE_KINDS.map((k) => ({ kind: k, items: notices.value.filter((n) => n.kind === k).sort((a, b) => b.noticeId - a.noticeId) })),
);
const nReason = computed(() => {
  const len = nForm.body.trim().length;
  if (len < 10) return '고지 문구를 10자 이상 입력해 주세요';
  if (len > 1000) return '고지 문구는 1000자까지입니다';
  const cur = byKind.value.find((g) => g.kind === nForm.kind)?.items[0];
  if (cur && cur.body.trim() === nForm.body.trim()) return '현재 판본과 같은 문구입니다';
  return null;
});

async function loadNotices() {
  if (!canNotices.value) return;
  nLoading.value = true;
  nErr.value = null;
  try {
    notices.value = await get<Notice[]>('/api/admin/notices');
  } catch (e) {
    nErr.value = e;
  } finally {
    nLoading.value = false;
  }
}
function startFrom(n: Notice) {
  nForm.kind = n.kind;
  nForm.body = n.body;
  document.getElementById('cn-body')?.focus();
}
async function addNotice() {
  if (nBusy.value || nReason.value) return;
  nBusy.value = true;
  nSaveErr.value = null;
  try {
    const r = await post<Notice>('/api/admin/notices', { kind: nForm.kind, body: nForm.body.trim() });
    nAdded.value = r.noticeId;
    nForm.body = '';
    await loadNotices();
  } catch (e) {
    nSaveErr.value = e;
  } finally {
    nBusy.value = false;
  }
}

onMounted(() => {
  load();
  loadNotices();
});
</script>

<template>
  <div class="stack-lg">
    <CategoryTabs v-model="tab" :tabs="tabs" label="기준값·고지 구분" />

    <!-- 운영 기준값 -->
    <section v-if="tab === 'constants'" aria-labelledby="cn-c">
      <h2 id="cn-c" class="title-lg">운영 기준값</h2>
      <p class="body-sm muted">값이 비어 있으면 미설정이며, 시스템은 그 기준이 필요한 동작을 보수적으로 처리합니다.</p>
      <ActionError v-if="loadErr" :error="loadErr" :busy="loading" @retry="load" />
      <div v-else-if="loading && !constants.length" class="skeleton" style="height: 200px"></div>
      <ul v-else class="rows">
        <li v-for="c in constants" :key="c.key" class="crow">
          <div class="meta">
            <span class="row">
              <b class="title-sm mono key">{{ c.key }}</b>
              <StatusBadge v-if="c.value == null" tone="warn" label="미설정 — 보수적 동작" />
              <StatusBadge v-else-if="rowSaved === `c:${c.key}`" tone="ok" label="저장됨" />
            </span>
            <span class="body-sm">{{ c.description }}</span>
          </div>
          <form class="edit" @submit.prevent="saveConstant(c, cEdit[c.key])">
            <div class="field">
              <label :for="`cn-v-${c.key}`" class="sr-only">{{ c.key }} 값</label>
              <span class="with-unit">
                <input :id="`cn-v-${c.key}`" v-model="cEdit[c.key]" class="input" type="text" maxlength="100" placeholder="미설정" />
                <span v-if="c.unit" class="caption unit">{{ c.unit }}</span>
              </span>
            </div>
            <div class="row">
              <BaseButton type="submit" size="sm" :busy="rowBusy === `c:${c.key}`" :disabled="(cEdit[c.key] ?? '') === (c.value ?? '')"
                >저장</BaseButton
              >
              <InlineConfirm
                v-if="c.value != null"
                label="미설정으로"
                :question="`${c.key} 를 미설정으로 바꿀까요? 관련 동작이 보수적으로 바뀝니다.`"
                confirm-label="미설정으로"
                :busy="rowBusy === `c:${c.key}`"
                @confirm="saveConstant(c, null)"
              />
            </div>
          </form>
          <ActionError
            v-if="rowErr[`c:${c.key}`]"
            class="full"
            :error="rowErr[`c:${c.key}`].error"
            keeps-input
            title="저장하지 못했습니다"
            @retry="rowErr[`c:${c.key}`].retry()"
          />
        </li>
      </ul>
    </section>

    <!-- 요금 -->
    <section v-else-if="tab === 'plans'" aria-labelledby="cn-p">
      <h2 id="cn-p" class="title-lg">요금</h2>
      <p class="body-sm muted">
        금액이 미설정인 요금제는 이용권 화면에 "요금 미설정"으로 보이고 결제할 수 없습니다. 이미 결제된 금액은 바뀌지 않습니다.
      </p>
      <ActionError v-if="loadErr" :error="loadErr" :busy="loading" @retry="load" />
      <ul v-else class="rows">
        <li v-for="p in plans" :key="p.plan_code" class="crow">
          <div class="meta">
            <span class="row">
              <b class="title-sm">{{ p.plan_name }}</b>
              <StatusBadge v-if="p.price_amount == null" tone="warn" label="미설정 — 결제 불가" />
              <StatusBadge v-else-if="rowSaved === `p:${p.plan_code}`" tone="ok" label="저장됨" />
            </span>
            <span class="body-sm">
              현재 {{ fmtMoney(p.price_amount == null ? null : Number(p.price_amount)) }} ·
              {{ p.plan_code === 'monthly' ? `${p.period_months}개월` : `분석 ${p.analysis_quota}회` }}
            </span>
          </div>
          <form class="edit" @submit.prevent="savePrice(p, pEdit[p.plan_code])">
            <div class="field">
              <label :for="`cn-pr-${p.plan_code}`" class="sr-only">{{ p.plan_name }} 금액(원)</label>
              <span class="with-unit">
                <input
                  :id="`cn-pr-${p.plan_code}`"
                  v-model="pEdit[p.plan_code]"
                  class="input"
                  type="text"
                  inputmode="numeric"
                  placeholder="미설정"
                  :aria-invalid="priceInvalid(p.plan_code) ? 'true' : undefined"
                />
                <span class="caption unit">원</span>
              </span>
              <span v-if="priceInvalid(p.plan_code)" class="error-text">숫자만 입력해 주세요</span>
            </div>
            <div class="row">
              <BaseButton
                type="submit"
                size="sm"
                :busy="rowBusy === `p:${p.plan_code}`"
                :disabled="
                  priceInvalid(p.plan_code) || pEdit[p.plan_code] === (p.price_amount == null ? '' : String(Number(p.price_amount)))
                "
              >
                저장
              </BaseButton>
              <InlineConfirm
                v-if="p.price_amount != null"
                label="미설정으로"
                question="금액을 미설정으로 바꿀까요? 이 요금제는 결제할 수 없게 됩니다."
                confirm-label="미설정으로"
                :busy="rowBusy === `p:${p.plan_code}`"
                @confirm="savePrice(p, null)"
              />
            </div>
          </form>
          <ActionError
            v-if="rowErr[`p:${p.plan_code}`]"
            class="full"
            :error="rowErr[`p:${p.plan_code}`].error"
            keeps-input
            title="저장하지 못했습니다"
            @retry="rowErr[`p:${p.plan_code}`].retry()"
          />
        </li>
      </ul>
    </section>

    <!-- 고지 판본 -->
    <section v-else-if="tab === 'notices' && canNotices" class="stack-lg" aria-labelledby="cn-n">
      <div>
        <h2 id="cn-n" class="title-lg">고지 판본</h2>
        <p class="body-sm muted">고지는 고치지 않고 새 판본을 추가합니다. 이미 나간 결과는 당시 판본을 그대로 보여 줍니다.</p>
      </div>

      <form class="panel stack" @submit.prevent="addNotice">
        <h3 class="title-md">새 판본 추가</h3>
        <div class="field">
          <label for="cn-kind">고지 종류</label>
          <select id="cn-kind" v-model="nForm.kind" class="select">
            <option v-for="k in NOTICE_KINDS" :key="k" :value="k">{{ NOTICE_KIND_LABEL[k] }}</option>
          </select>
        </div>
        <div class="field">
          <label for="cn-body" class="req">고지 문구</label>
          <textarea id="cn-body" v-model="nForm.body" class="textarea" maxlength="1000"></textarea>
          <span class="hint">{{ nForm.body.trim().length }}/1000 · 10자 이상</span>
        </div>
        <ActionError v-if="nSaveErr" :error="nSaveErr" :busy="nBusy" keeps-input title="판본을 추가하지 못했습니다" @retry="addNotice" />
        <div class="row">
          <BaseButton type="submit" :busy="nBusy" :disabled="!!nReason">새 판본 추가</BaseButton>
          <span v-if="nReason" class="caption">{{ nReason }}</span>
          <StatusBadge v-else-if="nAdded" tone="ok" label="추가함" />
        </div>
      </form>

      <ActionError v-if="nErr" :error="nErr" :busy="nLoading" @retry="loadNotices" />
      <div v-else class="kinds">
        <section v-for="g in byKind" :key="g.kind" class="kind" :aria-labelledby="`cn-k-${g.kind}`">
          <h3 :id="`cn-k-${g.kind}`" class="title-md">{{ NOTICE_KIND_LABEL[g.kind] ?? g.kind }}</h3>
          <p v-if="!g.items.length" class="empty">판본이 없습니다 — 이 고지가 필요한 결과는 만들어지지 않습니다</p>
          <ol v-else class="versions">
            <li v-for="(n, i) in g.items" :key="n.noticeId" :class="{ current: i === 0 }">
              <span class="row">
                <StatusBadge :tone="i === 0 ? 'ok' : 'na'" :label="i === 0 ? '현재 판본' : '이전 판본'" />
                <span class="caption">#{{ n.noticeId }} · {{ fmtDate(n.effectiveFrom, true) }}부터</span>
              </span>
              <p class="body-sm text">{{ n.body }}</p>
              <BaseButton v-if="i === 0" variant="text" size="sm" @click="startFrom(n)">이 문구로 새 판본 쓰기</BaseButton>
            </li>
          </ol>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.rows {
  border-top: 1px solid var(--ink);
  margin-top: var(--s-md);
}
.crow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--s-sm) var(--s-lg);
  padding: var(--s-md) 0;
  border-bottom: 1px solid var(--hairline);
}
.crow .full {
  grid-column: 1 / -1;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.key {
  word-break: break-all;
}
.edit {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--s-xs);
}
.edit .field {
  flex: 1 1 180px;
  min-width: 0;
}
.with-unit {
  display: flex;
  align-items: center;
  gap: var(--s-xs);
}
.unit {
  flex: none;
}
.kinds {
  display: grid;
  gap: var(--s-lg);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr));
}
.kind {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.versions {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--ink);
}
.versions li {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--s-xs);
  padding: var(--s-sm) 0;
  border-bottom: 1px solid var(--hairline);
}
.versions li.current {
  background: var(--surface-soft);
  padding: var(--s-sm);
}
.text {
  color: var(--ink);
  white-space: pre-wrap;
}
@media (max-width: 767px) {
  .crow {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
