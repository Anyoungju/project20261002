<script setup lang="ts">
/**
 * C4 1차 참고용 고지 (FR-014 · FR-018 · FR-062 · FR-082) — 닫기·접기 없음, 인쇄에도 표시.
 * 본문은 서버가 준 notice_text 판본 그대로(결과가 가리키는 당시 판본).
 */
defineProps<{
  notice: { noticeId: number; body: string; kind?: string } | null;
  variant?: 'analysis' | 'priority' | 'share';
}>();
const TITLE = { analysis: '1차 참고용', priority: '참고용', share: '확정 전 고지' } as const;
</script>

<template>
  <aside class="notice" :class="variant ?? 'analysis'" role="note" :aria-label="TITLE[variant ?? 'analysis']">
    <p class="notice-title">
      <span class="mark" aria-hidden="true">◆</span>
      {{ TITLE[variant ?? 'analysis'] }}
      <span v-if="variant !== 'share'" class="sub">진단 책임 범위 안내</span>
    </p>
    <p class="notice-body">{{ notice?.body ?? '고지 문구를 불러오는 중입니다' }}</p>
    <slot />
    <p v-if="notice" class="notice-ver">고지 판본 #{{ notice.noticeId }}</p>
  </aside>
</template>

<style scoped>
.notice {
  background: var(--surface-soft);
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  padding: var(--s-md) var(--s-lg);
}
.notice-title {
  font: var(--t-label);
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: var(--s-xs);
  flex-wrap: wrap;
}
.notice-title .sub {
  font: var(--t-caption);
  text-transform: none;
  color: var(--muted);
}
.mark {
  font-size: 10px;
}
.notice-body {
  font: var(--t-body-sm);
  color: var(--body);
  margin-top: var(--s-xs);
}
.notice-ver {
  font: var(--t-caption);
  color: var(--muted);
  margin-top: var(--s-xs);
}
@media print {
  .notice {
    display: block !important;
    border: 1px solid var(--ink);
  }
}
</style>
