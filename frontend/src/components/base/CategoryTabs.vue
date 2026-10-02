<script setup lang="ts">
/** 스타일가이드 Category Tabs — 활성 탭은 ink 2px 밑줄, 700 */
defineProps<{ tabs: Array<{ value: string; label: string; count?: number | null }>; modelValue: string; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
</script>

<template>
  <div class="tabs" role="tablist" :aria-label="label">
    <button
      v-for="t in tabs"
      :key="t.value"
      type="button"
      role="tab"
      class="tab"
      :aria-selected="modelValue === t.value"
      :tabindex="modelValue === t.value ? 0 : -1"
      @click="emit('update:modelValue', t.value)"
    >
      {{ t.label }}<span v-if="t.count != null" class="count">{{ t.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: var(--s-lg);
  border-bottom: 1px solid var(--hairline);
  overflow-x: auto;
}
.tab {
  flex: none;
  min-height: var(--touch);
  padding: 0 var(--s-xxs);
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: none;
  color: var(--muted);
  font: var(--t-nav);
  cursor: pointer;
}
.tab[aria-selected='true'] {
  color: var(--ink);
  font-weight: 700;
  border-bottom-color: var(--ink);
}
.count {
  margin-left: 6px;
  font: var(--t-caption);
  color: var(--muted);
}
</style>
