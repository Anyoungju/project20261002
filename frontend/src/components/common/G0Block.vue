<script setup lang="ts">
/**
 * G0 권한 없음 블록 (FR-003 · FR-006) — "이 화면을 볼 권한이 없습니다" + [권한 요청 보내기].
 * 요청은 기록되고(permission_request) 처리자(기업 관리자·운영자)에게 알림이 간다.
 */
import { computed, ref } from 'vue';
import { post, errorMessage, type GateBlock } from '@/api/client';
import { useGates } from '@/stores/gates';
import { useSession } from '@/stores/session';
import C2GateBlock from './C2GateBlock.vue';
import BaseButton from '@/components/base/BaseButton.vue';

const props = defineProps<{
  screen: string;
  buildingId?: number | null;
  orgId?: number | null;
  reason?: string;
  block?: GateBlock | null;
}>();
const gates = useGates();
const session = useSession();
const busy = ref(false);
const sentAt = ref<string | null>(null);
const err = ref('');

const block = computed<GateBlock>(
  () =>
    props.block ?? {
      gate: 'G0',
      message: gates.messageOf('G0'),
      reason: props.reason,
      releaseParty: gates.releasePartyOf('G0'),
      selfRelease: false,
      actions: [{ id: 'permission-request', label: '권한 요청 보내기' }],
    },
);

async function send() {
  if (!session.loggedIn) return;
  busy.value = true;
  err.value = '';
  try {
    await post('/api/permission-requests', {
      requestedScreen: props.screen,
      buildingId: props.buildingId ?? undefined,
      orgId: props.orgId ?? undefined,
    });
    const d = new Date();
    sentAt.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch (e) {
    err.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
function onAction(a: { id: string }) {
  if (a.id === 'permission-request') send();
}
</script>

<template>
  <C2GateBlock :block="block" :busy-action="busy ? 'permission-request' : null" :sent-at="sentAt" @action="onAction">
    <p v-if="!session.loggedIn" class="body-sm">권한 요청을 보내려면 먼저 로그인하세요.</p>
    <div v-if="!session.loggedIn" class="row" style="margin-top: 8px">
      <BaseButton size="sm" :to="{ path: '/login', query: { returnTo: $route.fullPath } }">로그인</BaseButton>
    </div>
    <p v-if="err" class="body-sm" style="color: var(--error-text)">
      {{ err }} <button type="button" class="link-retry" @click="send">다시 시도</button>
    </p>
  </C2GateBlock>
</template>

<style scoped>
.link-retry {
  background: none;
  border: 0;
  color: var(--primary);
  font: var(--t-body-sm);
  font-weight: 700;
  cursor: pointer;
  min-height: 32px;
}
</style>
