<script setup lang="ts">
/**
 * C1 진행 레일 (SD_02 §2-3 · §3-2) — 화면 맨 위 고정.
 * case: 건 번호 | 1 분석 > 2 현장 기록 > 3 전문가 검증 > 4 조치 (완료·현재·차단(Gn)·해당 없음)
 * building: 건물명 | 이력 N | 지연 N | 연결 대기 N · worker: 배정 N | 지연 N | 자료 요청 N
 */
import { computed } from 'vue';

interface Stage {
  key: string;
  label: string;
  state: string; // done · current · pending · n/a · blocked:Gn
}
const props = defineProps<{
  variant: 'case' | 'building' | 'worker';
  title?: string;
  stages?: Stage[];
  counts?: Array<{ label: string; value: number; alert?: boolean }>;
}>();

const view = computed(() =>
  (props.stages ?? []).map((s, i) => {
    const blocked = s.state.startsWith('blocked:');
    const gate = blocked ? s.state.split(':')[1] : null;
    const kind = blocked ? 'blocked' : s.state === 'n/a' ? 'na' : s.state;
    const text =
      kind === 'done'
        ? `${i + 1} ${s.label} 완료`
        : kind === 'blocked'
          ? `${i + 1} ${s.label} - 차단 ${gate}`
          : kind === 'na'
            ? `${i + 1} 해당 없음`
            : `${i + 1} ${s.label}`;
    return { ...s, kind, text, gate };
  }),
);
</script>

<template>
  <nav class="rail" :aria-label="variant === 'case' ? '하자 건 진행' : variant === 'building' ? '건물 현황' : '내 작업 현황'">
    <div class="container rail-inner">
      <strong class="rail-title">{{ title }}</strong>
      <ol v-if="variant === 'case'" class="stages">
        <li
          v-for="(s, i) in view"
          :key="s.key"
          class="stage"
          :class="`st-${s.kind}`"
          :aria-current="s.kind === 'current' ? 'step' : undefined"
        >
          <span v-if="i > 0" class="sep" aria-hidden="true">›</span>
          <a v-if="s.kind === 'blocked'" href="#gate-block" class="stage-text">{{ s.text }}</a>
          <span v-else class="stage-text">{{ s.text }}</span>
        </li>
      </ol>
      <ul v-else class="counts">
        <li v-for="c in counts" :key="c.label" :class="{ alert: c.alert && c.value > 0 }">
          <span class="sep" aria-hidden="true">|</span>
          {{ c.label }} <b>{{ c.value }}</b
          >건
          <span v-if="c.alert && c.value > 0" class="sr-only">주의 필요</span>
        </li>
      </ul>
    </div>
  </nav>
</template>

<style scoped>
.rail {
  position: sticky;
  top: 64px;
  z-index: 20;
  background: var(--surface-soft);
  border-bottom: 1px solid var(--hairline);
}
.rail-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-xs) var(--s-md);
  min-height: 48px;
  padding-top: var(--s-xs);
  padding-bottom: var(--s-xs);
  font: var(--t-body-sm);
  font-weight: 400;
}
.rail-title {
  font: var(--t-title-sm);
  color: var(--ink);
}
.stages,
.counts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-xxs) var(--s-xs);
}
.stage,
.counts li {
  display: inline-flex;
  align-items: center;
  gap: var(--s-xs);
  color: var(--body);
}
.sep {
  color: var(--muted-soft);
}
.stage-text {
  padding: 2px 0;
}
.st-done .stage-text {
  color: var(--success-text);
}
.st-done .stage-text::before {
  content: '● ';
  font-size: 9px;
  vertical-align: 2px;
}
.st-current .stage-text {
  font-weight: 700;
  color: var(--ink);
  border-bottom: 2px solid var(--primary);
}
.st-blocked .stage-text {
  color: var(--error-text);
  border: 1px solid var(--error);
  padding: 2px 6px;
  font-weight: 700;
}
.st-na .stage-text {
  color: var(--muted);
  font-style: normal;
}
.st-pending .stage-text {
  color: var(--muted);
}
.counts b {
  color: var(--ink);
}
.counts li.alert,
.counts li.alert b {
  color: var(--error-text);
  font-weight: 700;
}
.counts li:first-child .sep {
  display: none;
}
@media (max-width: 767px) {
  .rail {
    top: 56px;
  }
  .rail-inner {
    font-size: 13px;
  }
}
</style>
