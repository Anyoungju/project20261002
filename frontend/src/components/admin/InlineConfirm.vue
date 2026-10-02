<script setup lang="ts">
/** 인라인 확인(모달·window.confirm 금지) — 첫 클릭은 확인 줄을 펼치고, [확인]에서만 실행 */
import { nextTick, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';

withDefaults(defineProps<{ label: string; question: string; confirmLabel?: string; busy?: boolean; variant?: 'primary' | 'secondary' }>(), {
  confirmLabel: '확인',
  busy: false,
  variant: 'secondary',
});
const emit = defineEmits<{ confirm: [] }>();
const open = ref(false);
const box = ref<HTMLElement | null>(null);
function start() {
  open.value = true;
  nextTick(() => box.value?.querySelector<HTMLElement>('button')?.focus());
}
function ok() {
  emit('confirm');
  open.value = false;
}
defineExpose({ close: () => (open.value = false) });
</script>

<template>
  <BaseButton v-if="!open" :variant="variant" size="sm" :busy="busy" @click="start">{{ label }}</BaseButton>
  <div v-else ref="box" class="confirm" role="group" :aria-label="question">
    <p class="body-sm q">{{ question }}</p>
    <div class="row">
      <BaseButton size="sm" :busy="busy" @click="ok">{{ confirmLabel }}</BaseButton>
      <BaseButton size="sm" variant="secondary" @click="open = false">취소</BaseButton>
    </div>
  </div>
</template>

<style scoped>
.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  padding: var(--s-sm);
  border: 1px solid var(--hairline-strong);
  border-left: 4px solid var(--ink);
  background: var(--surface-soft);
}
.q {
  color: var(--ink);
}
</style>
