<script setup lang="ts">
/**
 * C6 하자 건 요약 (SD_02 §3-5) — 사진 · 설명 · AI 원인·대응 · 현장 기록 · 판정을 한 묶음.
 * 변형: expanded(S4 비교) · collapsed(S8A·S8B 상단) · row(S5 이력 상세). 비어 있는 칸은 "해당 단계 미진행".
 */
import { computed, ref } from 'vue';
import PhotoThumb from './PhotoThumb.vue';
import StatusBadge from './StatusBadge.vue';
import C4ReferenceNotice from './C4ReferenceNotice.vue';
import { RISK_LABEL, riskTone, fmtDate } from '@/composables/useCan';

const props = withDefaults(
  defineProps<{
    summary: {
      caseNo?: string;
      building?: { buildingName: string | null; buildingTypeName?: string | null } | null;
      description?: string | null;
      result?: any | null;
      photos?: any[];
      records?: any[];
      verdicts?: any[];
    };
    variant?: 'expanded' | 'collapsed' | 'row';
  }>(),
  { variant: 'expanded' },
);
const open = ref(props.variant !== 'collapsed');
const savedRecord = computed(() => (props.summary.records ?? []).find((r: any) => r.recordStatus === 'saved' || r.savedAt) ?? null);
const currentVerdict = computed(() => (props.summary.verdicts ?? [])[0] ?? null);
</script>

<template>
  <section class="c6" :class="variant">
    <header class="c6-head">
      <div>
        <p class="caption">하자 건 {{ summary.caseNo }}</p>
        <p class="title-sm">
          {{ summary.building?.buildingName ?? '건물 미연결(일반 사용자 건)'
          }}<span v-if="summary.building?.buildingTypeName" class="muted"> · {{ summary.building.buildingTypeName }}</span>
        </p>
      </div>
      <button v-if="variant === 'collapsed'" type="button" class="toggle" :aria-expanded="open" @click="open = !open">
        {{ open ? '요약 접기' : '요약 펼치기' }}
      </button>
    </header>
    <div v-show="open" class="c6-body">
      <div class="cell">
        <p class="cell-src">분석 · 사진·설명</p>
        <div v-if="summary.photos?.length" class="photos">
          <PhotoThumb v-for="p in summary.photos.slice(0, 4)" :key="p.kind + p.photoId" :photo="p" />
        </div>
        <p class="body-sm">{{ summary.description || '설명 없음' }}</p>
      </div>
      <div class="cell">
        <p class="cell-src">분석 · AI 원인·대응방안</p>
        <template v-if="summary.result">
          <div class="row">
            <StatusBadge :tone="riskTone(summary.result.riskLevel)" :label="RISK_LABEL[summary.result.riskLevel]" />
            <StatusBadge v-if="summary.result.lowConfidence" tone="warn" label="신뢰도 낮음" />
            <span class="caption">신뢰도 {{ summary.result.aiConfidence ?? '-' }}</span>
          </div>
          <ol class="list">
            <li v-for="c in summary.result.causes" :key="c.rank">
              <b>{{ c.rank }}.</b> {{ c.text }}
            </li>
          </ol>
          <ul class="list dash">
            <li v-for="a in summary.result.actions" :key="a.seq">{{ a.text }}</li>
          </ul>
          <C4ReferenceNotice v-if="variant !== 'row'" :notice="summary.result.notice" />
        </template>
        <p v-else class="na">해당 단계 미진행</p>
      </div>
      <div class="cell">
        <p class="cell-src">현장 · 점검 기록</p>
        <dl v-if="savedRecord" class="dl">
          <dt>위치</dt>
          <dd>{{ savedRecord.locationText }}</dd>
          <dt>하자 종류</dt>
          <dd>{{ savedRecord.defectTypeName ?? savedRecord.defectTypeCode }}</dd>
          <dt>보수 결과</dt>
          <dd>{{ savedRecord.repairStatus === 'completed' ? '완료' : '미완료' }}</dd>
          <dt>저장</dt>
          <dd>{{ fmtDate(savedRecord.savedAt, true) }}</dd>
        </dl>
        <p v-else class="na">해당 단계 미진행</p>
      </div>
      <div v-if="summary.verdicts" class="cell">
        <p class="cell-src">전문가 · 판정</p>
        <p v-if="currentVerdict" class="body-sm">
          <StatusBadge
            :tone="currentVerdict.verdict === 'match' ? 'ok' : 'warn'"
            :label="currentVerdict.verdict === 'match' ? '일치' : '불일치'"
          />
          v{{ currentVerdict.versionNo }} · {{ currentVerdict.opinion ?? '의견 없음' }}
        </p>
        <p v-else class="na">해당 단계 미진행</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.c6 {
  border: 1px solid var(--hairline);
  background: var(--canvas);
}
.c6-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--s-sm);
  padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--hairline);
}
.toggle {
  min-height: var(--touch);
  padding: 0 var(--s-md);
  border: 1px solid var(--hairline-strong);
  background: var(--canvas);
  font: var(--t-button);
  cursor: pointer;
}
.c6-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}
.cell {
  padding: var(--s-md) var(--s-lg);
  border-right: 1px solid var(--hairline);
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.cell:last-child {
  border-right: 0;
}
.cell-src {
  font: var(--t-label);
  color: var(--muted);
}
.photos {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--s-xs);
}
.list {
  font: var(--t-body-sm);
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
}
.dash li::before {
  content: '– ';
  color: var(--muted);
}
.na {
  font: var(--t-body-sm);
  color: var(--muted);
}
.row.c6 .c6-body {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}
@media (max-width: 767px) {
  .cell {
    border-right: 0;
    border-bottom: 1px solid var(--hairline);
    padding: var(--s-md);
  }
  .c6-head {
    padding: var(--s-md);
  }
}
</style>
