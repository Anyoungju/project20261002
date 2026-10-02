<script setup lang="ts">
/**
 * 관리 · 권한 요청 — G0 에서 사용자가 보낸 요청을 승인(현장 기록/건물 관리)하거나 거절.
 * 승인하면 건물 권한이 생기고 G0 해제가 기록된다(서버). 요청자는 알림을 받는다.
 */
import { onMounted, reactive, ref } from 'vue';
import { get, post } from '@/api/client';
import { fmtDate } from '@/composables/useCan';
import BaseButton from '@/components/base/BaseButton.vue';
import FilterChips from '@/components/base/FilterChips.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import ActionError from '@/components/admin/ActionError.vue';
import InlineConfirm from '@/components/admin/InlineConfirm.vue';
import { SCREEN_LABEL, roleLabel } from '@/components/admin/adminLabels';

const status = ref<'pending' | 'all'>('pending');
const rows = ref<any[]>([]);
const loading = ref(false);
const loadErr = ref<unknown>(null);
const kind = reactive<Record<number, 'record' | 'manage'>>({});
const busy = ref<string | null>(null);
const errs = reactive<Record<number, { error: unknown; resolution: 'granted' | 'rejected' }>>({});

const OPTS = [
  { value: 'pending', label: '대기 중' },
  { value: 'all', label: '전체' },
];
/** 서버 기본값과 같은 추천(S5·S7A·S8A = 건물 관리). 운영자가 바꿀 수 있다 */
const defaultKind = (screen: string): 'record' | 'manage' => (['S5', 'S7A', 'S8A'].includes(screen) ? 'manage' : 'record');

async function load() {
  loading.value = true;
  loadErr.value = null;
  try {
    rows.value = await get('/api/admin/permission-requests', { status: status.value });
    for (const r of rows.value) if (!kind[r.permReqId]) kind[r.permReqId] = defaultKind(r.requestedScreen);
  } catch (e) {
    loadErr.value = e;
  } finally {
    loading.value = false;
  }
}
function setStatus(v: string) {
  status.value = v as 'pending' | 'all';
  load();
}

async function resolve(r: any, resolution: 'granted' | 'rejected') {
  const key = `${resolution}-${r.permReqId}`;
  busy.value = key;
  delete errs[r.permReqId];
  try {
    await post(
      `/api/admin/permission-requests/${r.permReqId}`,
      resolution === 'granted' ? { resolution, accessKind: kind[r.permReqId] } : { resolution },
    );
    await load();
  } catch (e) {
    errs[r.permReqId] = { error: e, resolution };
  } finally {
    busy.value = null;
  }
}

const RES = { granted: { tone: 'ok', label: '승인됨' }, rejected: { tone: 'danger', label: '거절됨' } } as const;

onMounted(load);
</script>

<template>
  <div class="stack-lg">
    <div class="row-between">
      <h2 class="title-lg">권한 요청</h2>
      <FilterChips :options="OPTS" :model-value="status" label="요청 상태" @update:model-value="setStatus" />
    </div>

    <ActionError v-if="loadErr" :error="loadErr" :busy="loading" @retry="load" />
    <div v-else-if="loading && !rows.length" class="skeleton" style="height: 160px"></div>
    <p v-else-if="!rows.length" class="empty">{{ status === 'pending' ? '처리할 권한 요청이 없습니다' : '권한 요청이 없습니다' }}</p>

    <ul v-else class="reqs" aria-live="polite">
      <li v-for="r in rows" :key="r.permReqId" class="req">
        <div class="head">
          <span class="row">
            <b class="title-sm">{{ r.requester?.nameMasked ?? '알 수 없음' }}</b>
            <span class="caption">{{ r.requester?.emailMasked }}</span>
          </span>
          <StatusBadge
            v-if="r.resolution"
            :tone="RES[r.resolution as 'granted' | 'rejected']?.tone ?? 'na'"
            :label="RES[r.resolution as 'granted' | 'rejected']?.label ?? r.resolution"
          />
          <StatusBadge v-else tone="info" label="대기 중" />
        </div>
        <dl class="dl">
          <dt>요청 화면</dt>
          <dd>{{ SCREEN_LABEL[r.requestedScreen] ?? r.requestedScreen }} ({{ r.requestedScreen }})</dd>
          <dt>건물</dt>
          <dd>
            {{ r.buildingName ?? '지정 없음' }}<template v-if="r.orgName"> · {{ r.orgName }}</template>
          </dd>
          <dt>현재 역할</dt>
          <dd>{{ r.requesterRoles?.length ? r.requesterRoles.map(roleLabel).join(', ') : '없음' }}</dd>
          <dt>요청 시각</dt>
          <dd>{{ fmtDate(r.requestedAt, true) }}</dd>
          <template v-if="r.resolution">
            <dt>처리</dt>
            <dd>{{ r.resolvedBy?.nameMasked ?? '-' }} · {{ fmtDate(r.resolvedAt, true) }}</dd>
          </template>
        </dl>

        <div v-if="!r.resolution" class="act">
          <template v-if="r.buildingId">
            <fieldset class="kind">
              <legend class="field-label">부여할 권한</legend>
              <div class="choice-group">
                <label class="choice"
                  ><input v-model="kind[r.permReqId]" type="radio" :name="`pr-k-${r.permReqId}`" value="record" />현장 기록</label
                >
                <label class="choice"
                  ><input v-model="kind[r.permReqId]" type="radio" :name="`pr-k-${r.permReqId}`" value="manage" />건물 관리</label
                >
              </div>
            </fieldset>
            <div class="row">
              <BaseButton size="sm" :busy="busy === `granted-${r.permReqId}`" :disabled="!!busy" @click="resolve(r, 'granted')"
                >승인</BaseButton
              >
              <InlineConfirm
                label="거절"
                question="이 요청을 거절할까요? 요청자에게 알림이 갑니다."
                confirm-label="거절"
                :busy="busy === `rejected-${r.permReqId}`"
                @confirm="resolve(r, 'rejected')"
              />
            </div>
          </template>
          <template v-else>
            <p class="body-sm muted">건물이 지정되지 않은 요청입니다. 계정·권한에서 역할로 처리한 뒤 거절로 닫아 주세요.</p>
            <div class="row">
              <BaseButton size="sm" variant="secondary" to="/admin/users">계정·권한으로</BaseButton>
              <InlineConfirm
                label="거절"
                question="이 요청을 거절할까요? 요청자에게 알림이 갑니다."
                confirm-label="거절"
                :busy="busy === `rejected-${r.permReqId}`"
                @confirm="resolve(r, 'rejected')"
              />
            </div>
          </template>
          <ActionError
            v-if="errs[r.permReqId]"
            :error="errs[r.permReqId].error"
            :busy="!!busy"
            title="처리하지 못했습니다"
            @retry="resolve(r, errs[r.permReqId].resolution)"
          />
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.reqs {
  display: grid;
  gap: var(--s-md);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
}
.req {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  padding: var(--s-md);
  border: 1px solid var(--hairline);
  background: var(--canvas);
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-xs);
}
.act {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  padding-top: var(--s-sm);
  border-top: 1px solid var(--hairline);
}
.kind {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.kind legend {
  padding: 0;
  margin-bottom: var(--s-xs);
}
</style>
