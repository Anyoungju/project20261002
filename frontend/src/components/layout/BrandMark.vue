<script setup lang="ts">
/** Buildcare 자체 마크 — 건물 윤곽 + 점검 표시(브랜드 로고 차용 없음). 색은 토큰만 */
defineProps<{ size?: number; onDark?: boolean }>();
</script>

<template>
  <svg :width="size ?? 32" :height="size ?? 32" viewBox="0 0 32 32" aria-hidden="true" class="mark" :class="{ dark: onDark }">
    <rect x="1" y="1" width="30" height="30" class="bg" />
    <path d="M8 25V11l8-5 8 5v14" class="line" />
    <path d="M12 25v-6h8v6" class="line" />
    <path d="M13 13h6" class="accent" />
  </svg>
</template>

<style scoped>
.bg {
  fill: var(--ink);
}
.line {
  fill: none;
  stroke: var(--on-dark);
  stroke-width: 2;
  stroke-linejoin: miter;
}
.accent {
  stroke: var(--primary);
  stroke-width: 3;
}
.dark .bg {
  fill: var(--on-dark);
}
.dark .line {
  stroke: var(--ink);
}
</style>
