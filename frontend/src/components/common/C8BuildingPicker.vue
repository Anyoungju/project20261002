<script setup lang="ts">
/**
 * C8 권한 범위 건물 선택기 (FR-030 · FR-050) — 권한 밖 건물은 목록에 없다.
 * 데스크톱 드롭다운 · 모바일 전체 화면 목록. 0개면 G0 블록.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { get } from '@/api/client';
import G0Block from './G0Block.vue';

export interface BuildingItem {
  buildingId: number;
  buildingName: string;
  buildingTypeName: string;
  orgName: string | null;
  access: string[];
}
const props = defineProps<{
  modelValue: number | null;
  access?: 'record' | 'manage';
  label?: string;
  multiple?: boolean;
  selected?: number[];
  screen?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [number | null]; 'update:selected': [number[]]; loaded: [BuildingItem[]] }>();
const items = ref<BuildingItem[]>([]);
const loading = ref(true);
const sheet = ref(false);
const isMobile = ref(false);

onMounted(async () => {
  isMobile.value = window.matchMedia('(max-width: 767px)').matches;
  try {
    items.value = await get<BuildingItem[]>('/api/buildings', { access: props.access });
    emit('loaded', items.value);
    // 선택 전이면 첫 건물을 미리 골라 둔다(언제든 바꿀 수 있음) — 빈 화면 대신 바로 내용을 보여 준다
    if (!props.multiple && !props.modelValue && items.value.length >= 1) emit('update:modelValue', items.value[0].buildingId);
  } finally {
    loading.value = false;
  }
});
watch(
  () => props.modelValue,
  () => (sheet.value = false),
);
const current = computed(() => items.value.find((b) => b.buildingId === props.modelValue) ?? null);
function pick(id: number) {
  emit('update:modelValue', id);
  sheet.value = false;
}
function toggle(id: number) {
  const s = new Set(props.selected ?? []);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  emit('update:selected', [...s]);
}
const noAccess = computed(() => !loading.value && items.value.length === 0);
</script>

<template>
  <div class="c8">
    <p v-if="loading" class="skeleton" style="height: 48px" aria-label="건물 목록을 불러오는 중"></p>
    <G0Block v-else-if="noAccess" :screen="screen ?? 'S5'" reason="권한이 있는 건물이 없습니다" />
    <template v-else-if="multiple">
      <fieldset class="multi">
        <legend class="field-label">{{ label ?? '건물 범위' }}</legend>
        <div class="choice-group">
          <label v-for="b in items" :key="b.buildingId" class="choice">
            <input type="checkbox" :checked="selected?.includes(b.buildingId)" @change="toggle(b.buildingId)" />
            <span class="box" aria-hidden="true"></span>
            {{ b.buildingName }}
          </label>
        </div>
      </fieldset>
    </template>
    <template v-else>
      <div v-if="!isMobile" class="field">
        <label :for="'c8-select'">{{ label ?? '건물' }}</label>
        <select
          id="c8-select"
          class="select"
          :value="modelValue ?? ''"
          @change="emit('update:modelValue', Number(($event.target as HTMLSelectElement).value) || null)"
        >
          <option value="" disabled>건물을 선택하세요</option>
          <option v-for="b in items" :key="b.buildingId" :value="b.buildingId">{{ b.buildingName }} · {{ b.buildingTypeName }}</option>
        </select>
      </div>
      <div v-else class="field">
        <span class="field-label">{{ label ?? '건물' }}</span>
        <button type="button" class="mobile-trigger" :aria-expanded="sheet" @click="sheet = true">
          <span>{{ current ? `${current.buildingName} · ${current.buildingTypeName}` : '건물을 선택하세요' }}</span>
          <span aria-hidden="true">›</span>
        </button>
        <div v-if="sheet" class="sheet" role="dialog" aria-modal="true" aria-label="건물 선택">
          <div class="sheet-head">
            <strong class="title-md">건물 선택</strong>
            <button type="button" class="sheet-close" @click="sheet = false">닫기</button>
          </div>
          <ul>
            <li v-for="b in items" :key="b.buildingId">
              <button type="button" class="sheet-item" :aria-current="b.buildingId === modelValue" @click="pick(b.buildingId)">
                <b>{{ b.buildingName }}</b>
                <span class="caption"
                  >{{ b.buildingTypeName }}<template v-if="b.orgName"> · {{ b.orgName }}</template> · 권한
                  {{ b.access.map((a) => (a === 'manage' ? '관리' : '기록')).join('·') }}</span
                >
              </button>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mobile-trigger {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  min-height: var(--touch);
  padding: 0 var(--s-md);
  border: 1px solid var(--hairline-strong);
  background: var(--canvas);
  font: var(--t-body-md);
  font-weight: 400;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}
.sheet {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--canvas);
  overflow-y: auto;
}
.sheet-head {
  position: sticky;
  top: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--s-md);
  border-bottom: 1px solid var(--hairline);
  background: var(--canvas);
}
.sheet-close {
  min-height: var(--touch);
  padding: 0 var(--s-md);
  border: 1px solid var(--hairline-strong);
  background: var(--canvas);
  font: var(--t-button);
}
.sheet-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  min-height: 64px;
  padding: var(--s-sm) var(--s-md);
  border: 0;
  border-bottom: 1px solid var(--hairline);
  background: var(--canvas);
  text-align: left;
  font: var(--t-body-md);
  color: var(--ink);
  cursor: pointer;
}
.sheet-item[aria-current='true'] {
  border-left: 4px solid var(--primary);
}
.multi {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
</style>
