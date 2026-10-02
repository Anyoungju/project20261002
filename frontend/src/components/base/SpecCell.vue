<script setup lang="ts">
/** 스타일가이드 Spec Cells — 큰 700 숫자 + 캡션 라벨 */
defineProps<{ value: string | number | null; label: string; tone?: 'default' | 'alert' }>();
</script>

<template>
  <div class="spec" :class="tone">
    <p class="v">{{ value ?? '-' }}</p>
    <p class="l">{{ label }}</p>
  </div>
</template>

<style scoped>
.spec {
  padding: var(--s-lg) var(--s-md);
  border-top: 1px solid var(--ink);
  background: var(--canvas);
}
.v {
  font: var(--t-display-md);
  color: var(--ink);
}
.l {
  font: var(--t-caption);
  color: var(--muted);
  margin-top: var(--s-xxs);
}
.alert .v {
  color: var(--error-text);
}
</style>
