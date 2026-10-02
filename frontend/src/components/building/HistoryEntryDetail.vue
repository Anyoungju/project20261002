<script setup lang="ts">
/**
 * S5 이력 항목 상세 (FR-051 · UC5 기본흐름 4) — 읽기 전용(FR-055).
 * 내부 항목: C6 row 변형(사진 · AI 결과 · 현장 기록 · 판정) + C4 고지(AI 결과가 있으면 반드시) + 판정 판본 목록.
 * 외부 항목: 건물관리시스템 요약.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { get, errorMessage } from '@/api/client';
import { fmtDate } from '@/composables/useCan';
import C6CaseSummary from '@/components/common/C6CaseSummary.vue';
import C4ReferenceNotice from '@/components/common/C4ReferenceNotice.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import RetryBox from '@/components/base/RetryBox.vue';
import { useReference } from '@/stores/reference';

const props = defineProps<{
  buildingId: number;
  kind: string;
  sourceId: number;
  buildingName?: string | null;
  buildingTypeName?: string | null;
}>();
const reference = useReference();
const detail = ref<any | null>(null);
const loading = ref(false);
const err = ref('');

async function load() {
  loading.value = true;
  err.value = '';
  try {
    detail.value = await get(`/api/buildings/${props.buildingId}/history/${props.kind}/${props.sourceId}`);
  } catch (e) {
    err.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(() => [props.buildingId, props.kind, props.sourceId], load);

const summary = computed(() => {
  const d = detail.value;
  if (!d || d.kind === 'external') return null;
  return {
    caseNo: d.caseNo,
    building: { buildingName: props.buildingName ?? null, buildingTypeName: props.buildingTypeName ?? null },
    description: null,
    result: d.result,
    photos: [...(d.analysisPhotos ?? []), ...(d.record?.photos ?? [])],
    records: d.record ? [{ ...d.record, recordStatus: 'saved' }] : [],
    verdicts: d.verdicts ?? [],
  };
});
</script>

<template>
  <div class="detail" aria-live="polite">
    <p v-if="loading && !detail" class="skeleton" style="height: 120px" aria-label="이력 상세를 불러오는 중"></p>
    <RetryBox v-else-if="err" :message="err" :busy="loading" @retry="load" />
    <template v-else-if="detail">
      <!-- 외부 이력 -->
      <section v-if="detail.kind === 'external'" class="ext">
        <div class="row">
          <StatusBadge tone="na" label="외부" />
          <span class="caption">건물관리시스템에서 받은 이력 · 이 화면에서 수정할 수 없습니다</span>
        </div>
        <dl class="dl">
          <dt>발생일</dt>
          <dd>{{ fmtDate(detail.external.occurredOn) }}</dd>
          <dt>위치</dt>
          <dd>{{ detail.external.locationText ?? '-' }}</dd>
          <dt>하자 종류</dt>
          <dd>{{ detail.external.defectTypeCode ? reference.defectName(detail.external.defectTypeCode) : '-' }}</dd>
          <dt>내용</dt>
          <dd>{{ detail.external.summary ?? '-' }}</dd>
          <dt>외부 참조</dt>
          <dd class="mono">{{ detail.external.bmsRecordRef }}</dd>
        </dl>
      </section>

      <!-- 내부 이력 -->
      <template v-else-if="summary">
        <C6CaseSummary :summary="summary" variant="row" />
        <div v-if="detail.record && (detail.record.repairMethod || detail.record.inspectionNote)" class="extra">
          <p class="label-upper muted">현장 기록 상세</p>
          <dl class="dl">
            <template v-if="detail.record.repairMethod"
              ><dt>보수 방법</dt>
              <dd>{{ detail.record.repairMethod }}</dd></template
            >
            <template v-if="detail.record.inspectionNote"
              ><dt>점검 메모</dt>
              <dd>{{ detail.record.inspectionNote }}</dd></template
            >
          </dl>
        </div>
        <div v-if="detail.verdicts?.length" class="extra">
          <p class="label-upper muted">전문가 판정 판본</p>
          <ol class="versions">
            <li v-for="v in detail.verdicts" :key="v.versionNo">
              <span class="row">
                <b class="title-sm">v{{ v.versionNo }}</b>
                <StatusBadge :tone="v.verdict === 'match' ? 'ok' : 'warn'" :label="v.verdict === 'match' ? '일치' : '불일치'" />
                <StatusBadge v-if="v.riskHigh" tone="danger" label="위험 큼" />
                <span class="caption"
                  >{{ fmtDate(v.decidedAt, true) }}<template v-if="v.expert"> · 전문가 {{ v.expert.nameMasked }}</template></span
                >
              </span>
              <span class="body-sm"
                >{{ v.opinion ?? '의견 없음' }}<template v-if="v.diffNote"> · 차이: {{ v.diffNote }}</template></span
              >
            </li>
          </ol>
        </div>
        <!-- AI 결과를 보이면 고지도 같은 묶음 안에(닫기 없음) -->
        <C4ReferenceNotice v-if="detail.result" :notice="detail.result.notice" variant="analysis" />
      </template>
    </template>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  border: 1px solid var(--hairline-strong);
  background: var(--canvas);
  padding: var(--s-md);
}
.ext {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.extra {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.versions {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.versions li {
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
  padding: var(--s-xs) 0;
  border-bottom: 1px solid var(--hairline);
}
.dl {
  overflow-wrap: anywhere;
}
</style>
