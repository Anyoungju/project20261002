<script setup lang="ts">
/**
 * C5 위험 권고 (FR-015 · FR-121 · SD_02 §3-4) — 결과와 같은 블록 안.
 * 버튼은 expert_request.create 권한이 있고 건에 건물이 있을 때만(일반 사용자·비회원은 문구만).
 */
import { computed } from 'vue';
import { useSession } from '@/stores/session';
import StatusBadge from './StatusBadge.vue';
import BaseButton from '@/components/base/BaseButton.vue';

const props = defineProps<{
  riskLevel: 'normal' | 'caution' | 'danger' | string;
  lowConfidence?: boolean;
  caseId?: number | null;
  hasBuilding?: boolean;
  riskNoticeId?: number | null;
  source?: 'analysis' | 'verdict' | 'inspection';
}>();
const session = useSession();

const level = computed(() => (props.riskLevel === 'normal' && props.lowConfidence ? 'caution' : props.riskLevel));
const view = computed(() => {
  if (level.value === 'danger') {
    return {
      tone: 'danger' as const,
      badge: '위험',
      title: '위험 가능성',
      text:
        props.source === 'verdict'
          ? '전문가가 위험이 크다고 판정했습니다. 전문가 점검을 요청하세요.'
          : props.source === 'inspection'
            ? '정기점검 결과 위험 가능성이 있습니다. 전문가 점검을 요청하세요.'
            : '구조적 손상 가능성이 감지되었습니다. 전문가 점검을 요청하세요.',
    };
  }
  if (level.value === 'caution') {
    return {
      tone: 'warn' as const,
      badge: props.lowConfidence ? '주의 · 신뢰도 낮음' : '주의',
      title: '점검 권고',
      text: props.lowConfidence
        ? 'AI 신뢰도가 기준보다 낮습니다. 결과를 그대로 믿지 말고 전문가 점검을 받아 보세요.'
        : '진행 가능성이 있는 하자입니다. 30일 이내 재촬영하고 필요하면 전문가 점검을 받으세요.',
    };
  }
  return { tone: 'ok' as const, badge: '정상', title: '분석 완료', text: '정상 범위입니다. 다음 정기점검 때 다시 확인하세요.' };
});
const showButton = computed(
  () => view.value.tone !== 'ok' && session.can('expert_request.create') && !!props.hasBuilding && !!props.caseId,
);
const to = computed(() => ({
  path: '/expert-requests/new',
  query: {
    caseId: String(props.caseId),
    ...(props.riskNoticeId ? { riskNoticeId: String(props.riskNoticeId) } : {}),
    origin: props.source ?? 'analysis',
  },
}));
</script>

<template>
  <div class="risk" :class="`t-${view.tone}`" role="status">
    <div class="risk-head">
      <StatusBadge :tone="view.tone" :label="view.badge" size="md" />
      <strong class="risk-title">{{ view.title }}</strong>
    </div>
    <p class="risk-text">{{ view.text }}</p>
    <div v-if="showButton" class="risk-actions">
      <BaseButton :to="to">전문가 점검 요청</BaseButton>
    </div>
  </div>
</template>

<style scoped>
.risk {
  padding: var(--s-md) var(--s-lg);
  border-left: 4px solid;
}
.t-ok {
  border-color: var(--success);
  background: var(--success-tint);
}
.t-warn {
  border-color: var(--warning);
  background: var(--warning-tint);
}
.t-danger {
  border-color: var(--error);
  background: var(--error-tint);
}
.risk-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-sm);
}
.risk-title {
  font: var(--t-title-sm);
  color: var(--ink);
}
.risk-text {
  font: var(--t-body-sm);
  color: var(--body);
  margin-top: var(--s-xs);
}
.risk-actions {
  margin-top: var(--s-sm);
}
</style>
