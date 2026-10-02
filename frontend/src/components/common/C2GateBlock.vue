<script setup lang="ts">
/**
 * C2 게이트 차단 블록 (FR-004 ~ FR-007 · SD_02 §3-3)
 * - 첫 줄 = gate_def.block_message (gates 스토어, 하드코딩 금지)
 * - 닫기 버튼 없음. 서버 판정으로만 사라진다. 토스트·모달 대체 금지
 * - selfRelease=false 면 직접 해제 대신 «요청 보내기» 행동만
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { GateBlock, GateAction } from '@/api/client';
import { useGates } from '@/stores/gates';
import BaseButton from '@/components/base/BaseButton.vue';

const props = defineProps<{ block: GateBlock; busyAction?: string | null; sentAt?: string | null; compact?: boolean }>();
const emit = defineEmits<{ action: [GateAction] }>();
const gates = useGates();
const router = useRouter();

const first = computed(() => gates.messageOf(props.block.gate) || props.block.message);
const party = computed(() => gates.releasePartyOf(props.block.gate) || props.block.releaseParty);
const headingId = computed(() => `gate-${props.block.gate}-${props.block.gateEventId ?? 'x'}`);

function run(a: GateAction) {
  if (a.href && !['permission-request'].includes(a.id)) router.push(a.href);
  else emit('action', a);
}
</script>

<template>
  <section id="gate-block" class="gate" :class="{ compact }" role="region" :aria-labelledby="headingId" aria-live="polite">
    <div class="gate-body">
      <p :id="headingId" class="gate-title">
        {{ first }}
        <span class="gate-code" :aria-label="`안내 코드 ${block.gate}`">{{ block.gate }}</span>
      </p>
      <p v-if="block.reason && block.reason !== first" class="gate-reason">{{ block.reason }}</p>
      <ul v-if="block.missingFields?.length" class="gate-missing">
        <slot name="missing" :fields="block.missingFields" />
      </ul>
      <p class="gate-party">
        <template v-if="block.selfRelease">아래 버튼으로 바로 해결할 수 있어요 · 해결하는 사람: {{ party }}</template>
        <template v-else>{{ party }}의 확인이 필요해요. 요청을 보내면 처리 결과를 알림으로 알려 드려요.</template>
      </p>
      <p v-if="sentAt" class="gate-sent">요청 보냄 - {{ sentAt }}</p>
      <slot />
      <div v-if="block.actions.length && !sentAt" class="gate-actions">
        <BaseButton
          v-for="(a, i) in block.actions"
          :key="a.id"
          :variant="i === 0 ? 'primary' : 'secondary'"
          size="sm"
          :busy="busyAction === a.id"
          @click="run(a)"
        >
          {{ a.label }}
        </BaseButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gate {
  display: flex;
  background: var(--error-tint);
  border-left: 4px solid var(--error);
  padding: var(--s-md) var(--s-lg);
  margin: var(--s-md) 0;
}
.compact {
  padding: var(--s-sm) var(--s-md);
}
.gate-body {
  flex: 1;
  min-width: 0;
}
.gate-title {
  font: var(--t-title-sm);
  color: var(--ink);
}
.gate-code {
  display: inline-block;
  margin-left: var(--s-xs);
  padding: 1px 6px;
  border: 1px solid var(--hairline-strong);
  color: var(--muted);
  font: var(--t-caption);
  vertical-align: 2px;
}
.gate-reason {
  font: var(--t-body-sm);
  color: var(--body);
  margin-top: var(--s-xxs);
}
.gate-party {
  font: var(--t-body-sm);
  color: var(--muted);
  margin-top: var(--s-xxs);
}
.gate-sent {
  font: var(--t-body-sm);
  color: var(--ink);
  margin-top: var(--s-xs);
  font-weight: 400;
}
.gate-missing {
  margin-top: var(--s-xs);
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
}
.gate-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
  margin-top: var(--s-sm);
}
</style>
