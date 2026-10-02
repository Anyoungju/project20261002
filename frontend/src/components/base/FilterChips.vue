<script setup lang="ts">
/** 스타일가이드 Filter Chips — 0px, 1px hairline, 선택 시 ink 채움. 모바일 가로 스크롤 */
defineProps<{ options: Array<{ value: string; label: string }>; modelValue: string; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
</script>

<template>
  <div class="chips" role="group" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="chip"
      :aria-pressed="modelValue === o.value"
      @click="emit('update:modelValue', o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  gap: var(--s-xs);
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: thin;
}
.chip {
  flex: none;
  min-height: 40px;
  padding: 0 var(--s-md);
  border: 1px solid var(--hairline-strong);
  background: var(--canvas);
  color: var(--ink);
  font: var(--t-caption);
  font-size: 13px;
  cursor: pointer;
}
.chip[aria-pressed='true'] {
  background: var(--ink);
  color: var(--on-dark);
  border-color: var(--ink);
  font-weight: 700;
}
@media (pointer: coarse) {
  .chip {
    min-height: var(--touch);
  }
}
</style>
