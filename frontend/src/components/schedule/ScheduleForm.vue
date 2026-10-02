<script setup lang="ts">
/**
 * S7A 일정 입력(생성·수정 공용) — 점검 항목 · 주기(OptionTile) · 기한 · 담당 시설관리자(마스킹 이름).
 * FR-073: 점검 결과 입력란은 두지 않는다.
 */
import { computed, ref, watch } from 'vue';
import { useReference } from '@/stores/reference';
import OptionTile from '@/components/base/OptionTile.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import C3ReasonedButton from '@/components/common/C3ReasonedButton.vue';

export interface ScheduleValues {
  itemText: string;
  cycleCode: string | null;
  dueDate: string;
  assigneeId: number | null;
}
const props = defineProps<{
  modelValue: ScheduleValues;
  assignees: Array<{ userId: number; nameMasked: string; phoneMasked?: string | null }>;
  idPrefix: string;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  cancelLabel?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [ScheduleValues]; submit: []; cancel: [] }>();
const reference = useReference();

const v = ref<ScheduleValues>({ ...props.modelValue });
watch(
  () => props.modelValue,
  (m) => {
    if (JSON.stringify(m) !== JSON.stringify(v.value)) v.value = { ...m };
  },
  { deep: true },
);
watch(v, (x) => emit('update:modelValue', { ...x }), { deep: true });

const cycleOptions = computed(() => [
  ...reference.cycles.map((c) => ({ value: c.code, label: c.name })),
  { value: '', label: '주기 미정' },
]);
const reason = computed(() => {
  if (!props.assignees.length) return '이 건물에 기록 권한이 있는 시설관리자가 없어 배정할 수 없습니다';
  if (v.value.itemText.trim().length < 2) return '점검 항목을 2자 이상 입력하세요';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.value.dueDate)) return '기한을 선택하세요';
  if (!v.value.assigneeId) return '담당 시설관리자를 선택하세요';
  return null;
});
function submit() {
  if (reason.value || props.busy) return;
  emit('submit');
}
</script>

<template>
  <form class="sform" novalidate @submit.prevent="submit">
    <div class="field">
      <label :for="`${idPrefix}-item`" class="req">점검 항목</label>
      <input
        :id="`${idPrefix}-item`"
        v-model="v.itemText"
        class="input"
        type="text"
        maxlength="200"
        autocomplete="off"
        placeholder="예: 옥상 방수층 상태 점검"
      />
    </div>
    <fieldset class="field">
      <legend class="field-label">점검 주기</legend>
      <div class="tiles">
        <OptionTile
          v-for="c in cycleOptions"
          :key="c.value || 'none'"
          :name="`${idPrefix}-cycle`"
          :value="c.value"
          :title="c.label"
          :selected="(v.cycleCode ?? '') === c.value"
          @select="v.cycleCode = $event || null"
        />
      </div>
    </fieldset>
    <div class="grid-2">
      <div class="field">
        <label :for="`${idPrefix}-due`" class="req">기한</label>
        <input :id="`${idPrefix}-due`" v-model="v.dueDate" class="input" type="date" />
      </div>
      <div class="field">
        <label :for="`${idPrefix}-assignee`" class="req">담당 시설관리자</label>
        <select
          :id="`${idPrefix}-assignee`"
          class="select"
          :value="v.assigneeId ?? ''"
          @change="v.assigneeId = Number(($event.target as HTMLSelectElement).value) || null"
        >
          <option value="" disabled>선택하세요</option>
          <option v-for="a in assignees" :key="a.userId" :value="a.userId">
            {{ a.nameMasked }}<template v-if="a.phoneMasked"> · {{ a.phoneMasked }}</template>
          </option>
        </select>
      </div>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <div class="row">
      <C3ReasonedButton type="submit" :busy="busy" :disabled="!!reason" :reason="reason">{{ submitLabel }}</C3ReasonedButton>
      <BaseButton variant="secondary" @click="emit('cancel')">{{ cancelLabel ?? '닫기' }}</BaseButton>
    </div>
  </form>
</template>

<style scoped>
.sform {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}
fieldset.field {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--s-xs);
}
.err {
  font: var(--t-body-sm);
  color: var(--error-text);
  border-left: 3px solid var(--error);
  padding-left: var(--s-sm);
}
.row {
  align-items: flex-start;
}
@media (max-width: 767px) {
  .tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
