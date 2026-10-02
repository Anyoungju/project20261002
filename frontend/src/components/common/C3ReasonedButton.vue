<script setup lang="ts">
/**
 * C3 이유 붙은 비활성 버튼 (FR-005) — 비활성이어도 포커스를 받고, 사유 문구는 C2 첫 줄과 글자까지 같다.
 * gate 를 주면 gate_def 문구를 쓴다. reason 은 게이트가 아닌 일반 사유(예: "사진을 1장 이상 올려 주세요").
 */
import { computed, useId } from 'vue';
import { useGates } from '@/stores/gates';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    gate?: string | null;
    reason?: string | null;
    busy?: boolean;
    variant?: 'primary' | 'secondary';
    type?: 'button' | 'submit';
    block?: boolean;
  }>(),
  { disabled: false, busy: false, variant: 'primary', type: 'button', block: false, gate: null, reason: null },
);
const emit = defineEmits<{ click: [MouseEvent] }>();
const gates = useGates();
const rid = useId();
const text = computed(() => (props.gate ? gates.messageOf(props.gate) : props.reason) || '');
const inert = computed(() => props.disabled || props.busy);
function onClick(e: MouseEvent) {
  if (inert.value) {
    e.preventDefault();
    return;
  }
  emit('click', e);
}
</script>

<template>
  <span class="reasoned" :class="{ block }">
    <button
      :type="type"
      class="rbtn"
      :class="[`v-${variant}`, { off: inert }]"
      :aria-disabled="inert ? 'true' : undefined"
      :aria-busy="busy ? 'true' : undefined"
      :aria-describedby="disabled && text ? rid : undefined"
      :title="disabled && text ? text : undefined"
      @click="onClick"
    >
      <template v-if="busy">처리 중</template>
      <slot v-else />
    </button>
    <span v-if="disabled && text" :id="rid" class="why">{{ text }}</span>
  </span>
</template>

<style scoped>
.reasoned {
  display: inline-flex;
  flex-direction: column;
  gap: var(--s-xxs);
  max-width: 100%;
}
.reasoned.block {
  display: flex;
  width: 100%;
}
.rbtn {
  min-height: var(--touch);
  min-width: var(--touch);
  padding: 14px var(--s-xl);
  border: 0;
  border-radius: var(--r-none);
  font: var(--t-button);
  letter-spacing: 0.5px;
  cursor: pointer;
}
.block .rbtn {
  width: 100%;
}
.v-primary {
  background: var(--primary);
  color: var(--on-primary);
}
.v-primary:active {
  background: var(--primary-active);
}
.v-secondary {
  background: var(--canvas);
  color: var(--ink);
  border: 1px solid var(--hairline-strong);
}
.off,
.off:active {
  background: var(--primary-disabled);
  color: var(--muted);
  border-color: var(--primary-disabled);
  cursor: not-allowed;
}
.why {
  font: var(--t-body-sm);
  color: var(--muted);
}
</style>
