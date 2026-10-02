<script setup lang="ts">
/**
 * AI 분석 결과 요약 (S3 미리 채움 · S4 비교) — 원인·대응방안 + 같은 블록 안의 C4 고지(닫기 없음).
 * 고지 없는 결과는 그리지 않는다(BR-DEF-01).
 */
import { RISK_LABEL, riskTone, fmtDate } from '@/composables/useCan';
import StatusBadge from '@/components/common/StatusBadge.vue';
import PhotoThumb from '@/components/common/PhotoThumb.vue';
import C4ReferenceNotice from '@/components/common/C4ReferenceNotice.vue';

defineProps<{
  result: any;
  photos?: any[];
  description?: string | null;
  heading?: string;
}>();
</script>

<template>
  <section v-if="result?.notice" class="brief" :aria-label="heading ?? 'AI 분석 결과'">
    <div class="brief-body">
      <p class="label-upper muted">{{ heading ?? 'AI 분석 결과' }}</p>
      <div v-if="photos?.length" class="photos">
        <PhotoThumb v-for="p in photos" :key="p.kind + p.photoId" :photo="p" />
      </div>
      <p v-if="description !== undefined" class="body-sm"><span class="muted">사용자 설명</span> {{ description || '설명 없음' }}</p>
      <div class="row">
        <StatusBadge :tone="riskTone(result.riskLevel)" :label="`위험도 ${RISK_LABEL[result.riskLevel] ?? result.riskLevel}`" />
        <StatusBadge v-if="result.lowConfidence" tone="warn" label="신뢰도 낮음" />
        <StatusBadge tone="ref" label="1차 참고용" />
        <span class="caption">AI 신뢰도 {{ result.aiConfidence ?? '-' }} · {{ fmtDate(result.completedAt, true) }}</span>
      </div>
      <div>
        <h4 class="title-sm">가능한 원인</h4>
        <ol class="list">
          <li v-for="c in result.causes" :key="c.rank">
            <b>{{ c.rank }}.</b> {{ c.text }}
          </li>
        </ol>
      </div>
      <div>
        <h4 class="title-sm">대응방안</h4>
        <ul class="list dash">
          <li v-for="a in result.actions" :key="a.seq">{{ a.text }}</li>
        </ul>
      </div>
    </div>
    <C4ReferenceNotice :notice="result.notice" variant="analysis" />
  </section>
</template>

<style scoped>
.brief {
  border: 1px solid var(--hairline);
  background: var(--canvas);
  display: flex;
  flex-direction: column;
}
.brief-body {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  padding: var(--s-md);
}
.photos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--s-xs);
}
.list {
  font: var(--t-body-sm);
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
  margin-top: var(--s-xxs);
}
.dash li::before {
  content: '– ';
  color: var(--muted);
}
</style>
