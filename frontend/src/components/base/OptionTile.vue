<script setup lang="ts">
/** 스타일가이드 Option Tiles — selected = 2px primary border. 라디오 의미 */
defineProps<{ selected: boolean; title: string; name: string; value: string; disabled?: boolean }>();
const emit = defineEmits<{ select: [string] }>();
</script>

<template>
  <label class="tile" :class="{ selected, disabled }">
    <input
      type="radio"
      class="sr-only"
      :name="name"
      :value="value"
      :checked="selected"
      :disabled="disabled"
      @change="emit('select', value)"
    />
    <span class="tile-title">{{ title }}</span>
    <span class="tile-body"><slot /></span>
  </label>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  padding: var(--s-lg);
  border: 1px solid var(--hairline-strong);
  background: var(--canvas);
  cursor: pointer;
  min-height: 120px;
}
.tile.selected {
  border: 2px solid var(--primary);
  padding: calc(var(--s-lg) - 1px);
}
.tile.disabled {
  cursor: not-allowed;
  background: var(--surface-soft);
}
.tile:has(input:focus-visible) {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.tile-title {
  font: var(--t-title-md);
  color: var(--ink);
}
.tile-body {
  font: var(--t-body-sm);
  color: var(--body);
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
}
</style>
