<script setup lang="ts">
/** C7 데이터 출처 표시줄 — 외부 미반영 · 제외 건물 수 · 신뢰도 낮음. 데이터를 막지 않는다(막는 것은 C2) */
import { ref } from 'vue';
const props = defineProps<{ items: Array<{ key: string; label: string; detail?: string | null }> }>();
const open = ref<string | null>(null);
</script>

<template>
  <div v-if="props.items.length" class="c7" role="status">
    <span class="c7-mark" aria-hidden="true">▲</span>
    <template v-for="(it, i) in items" :key="it.key">
      <span v-if="i > 0" class="sep" aria-hidden="true">|</span>
      <button
        v-if="it.detail"
        type="button"
        class="c7-item"
        :aria-expanded="open === it.key"
        @click="open = open === it.key ? null : it.key"
      >
        {{ it.label }}
      </button>
      <span v-else class="c7-item static">{{ it.label }}</span>
    </template>
    <p v-if="open" class="c7-detail">{{ items.find((x) => x.key === open)?.detail }}</p>
  </div>
</template>

<style scoped>
.c7 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-xxs) var(--s-xs);
  padding: var(--s-xs) var(--s-md);
  background: var(--warning-tint);
  border: 1px solid var(--warning);
  font: var(--t-body-sm);
  color: var(--warning-text);
  margin: var(--s-sm) 0;
}
.c7-mark {
  font-size: 10px;
}
.sep {
  color: var(--muted-soft);
}
.c7-item {
  background: none;
  border: 0;
  padding: 0;
  min-height: 32px;
  font: var(--t-body-sm);
  font-weight: 700;
  color: var(--warning-text);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.c7-item.static {
  text-decoration: none;
  cursor: default;
  display: inline-flex;
  align-items: center;
}
.c7-detail {
  flex-basis: 100%;
  color: var(--body);
  font: var(--t-body-sm);
}
</style>
