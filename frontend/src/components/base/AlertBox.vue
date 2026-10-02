<script setup lang="ts">
/** 스타일가이드 Alerts — 정상(success) · 권고(warning) · 위험(error) · 정보(ink). 아이콘·제목·색 3중 */
defineProps<{ tone: 'ok' | 'warn' | 'danger' | 'info'; title: string }>();
const MARK = { ok: '●', warn: '▲', danger: '■', info: 'i' } as const;
</script>

<template>
  <div class="alert" :class="`t-${tone}`" :role="tone === 'danger' ? 'alert' : 'status'">
    <span class="mark" aria-hidden="true">{{ MARK[tone] }}</span>
    <div>
      <p class="title-sm">{{ title }}</p>
      <div class="body-sm"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.alert {
  display: flex;
  gap: var(--s-sm);
  padding: var(--s-md);
  border-left: 4px solid;
}
.mark {
  font-size: 12px;
  line-height: 22px;
  font-weight: 700;
}
.t-ok {
  border-color: var(--success);
  background: var(--success-tint);
  color: var(--success-text);
}
.t-warn {
  border-color: var(--warning);
  background: var(--warning-tint);
  color: var(--warning-text);
}
.t-danger {
  border-color: var(--error);
  background: var(--error-tint);
  color: var(--error-text);
}
.t-info {
  border-color: var(--ink);
  background: var(--surface-soft);
  color: var(--ink);
}
.alert .body-sm {
  color: var(--body);
  margin-top: 2px;
}
</style>
