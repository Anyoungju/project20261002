<script setup lang="ts">
/**
 * FR-100 — 상태를 글자·색·형태 세 가지로 동시에 표현. 색만으로 구분하지 않는다.
 * ok(정상·완료 ●) · warn(주의·지연·신뢰도 낮음 ▲) · danger(위험·차단 ■) · ref(1차 참고용 ◆) · na(해당 없음 –) · info(예정 ○)
 */
import { computed } from 'vue';
const props = defineProps<{ tone: 'ok' | 'warn' | 'danger' | 'ref' | 'na' | 'info'; label: string; size?: 'sm' | 'md' }>();
const SHAPE = { ok: '●', warn: '▲', danger: '■', ref: '◆', na: '–', info: '○' } as const;
const shape = computed(() => SHAPE[props.tone]);
</script>

<template>
  <span class="badge" :class="[`tone-${tone}`, size === 'md' ? 'md' : '']">
    <span class="shape" aria-hidden="true">{{ shape }}</span>
    <span>{{ label }}</span>
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 1px solid currentColor;
  border-radius: var(--r-none);
  font: var(--t-caption);
  font-weight: 700;
  letter-spacing: 0.5px;
  white-space: nowrap;
  line-height: 1.3;
}
.md {
  font: var(--t-label);
  letter-spacing: 0.5px;
  padding: 5px 10px;
}
.shape {
  font-size: 10px;
  line-height: 1;
}
.tone-ok {
  color: var(--success-text);
  background: var(--success-tint);
}
.tone-warn {
  color: var(--warning-text);
  background: var(--warning-tint);
}
.tone-danger {
  color: var(--error-text);
  background: var(--error-tint);
}
.tone-ref {
  color: var(--ink);
  background: var(--surface-soft);
}
.tone-na {
  color: var(--muted);
  background: var(--canvas);
  border-style: dashed;
}
.tone-info {
  color: var(--primary);
  background: var(--canvas);
}
</style>
