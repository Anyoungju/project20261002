<script setup lang="ts">
/**
 * 사진 선택(다중) — 미리보기·삭제·업로드 전 축소(긴 변 1600px). 모바일은 capture 로 카메라 바로 열기.
 * v-model = File[]
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { shrinkImage } from '@/api/client';

const props = withDefaults(
  defineProps<{
    modelValue: File[];
    max?: number;
    capture?: boolean;
    label?: string;
    invalid?: boolean;
    id?: string;
    altPrefix?: string;
  }>(),
  { max: 10, capture: false, label: '사진', invalid: false, id: 'photo-picker', altPrefix: '하자 사진' },
);
const emit = defineEmits<{ 'update:modelValue': [File[]] }>();
const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const urls = ref<string[]>([]);

watch(
  () => props.modelValue,
  (files) => {
    urls.value.forEach((u) => URL.revokeObjectURL(u));
    urls.value = files.map((f) => URL.createObjectURL(f));
  },
  { immediate: true },
);
onBeforeUnmount(() => urls.value.forEach((u) => URL.revokeObjectURL(u)));

async function onChange(e: Event) {
  const list = Array.from((e.target as HTMLInputElement).files ?? []);
  (e.target as HTMLInputElement).value = '';
  if (!list.length) return;
  busy.value = true;
  try {
    const shrunk = await Promise.all(
      list.map(async (f) => {
        const b = await shrinkImage(f);
        return b === f ? f : new File([b], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
      }),
    );
    emit('update:modelValue', [...props.modelValue, ...shrunk].slice(0, props.max));
  } finally {
    busy.value = false;
  }
}
function remove(i: number) {
  const next = props.modelValue.slice();
  next.splice(i, 1);
  emit('update:modelValue', next);
}
const full = computed(() => props.modelValue.length >= props.max);
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="picker" :class="{ invalid }">
    <ul v-if="modelValue.length" class="previews">
      <li v-for="(u, i) in urls" :key="u" class="pv">
        <img :src="u" :alt="`${altPrefix} ${i + 1} 미리보기`" />
        <button type="button" class="rm" :aria-label="`사진 ${i + 1} 빼기`" @click="remove(i)">빼기</button>
      </li>
    </ul>
    <label class="drop" :class="{ disabled: full }" :for="id">
      <input
        :id="id"
        ref="input"
        class="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        :capture="capture ? 'environment' : undefined"
        :disabled="full"
        :aria-invalid="invalid ? 'true' : undefined"
        @change="onChange"
      />
      <span class="plus" aria-hidden="true">+</span>
      <span class="title-sm">{{
        busy ? '사진 준비 중' : full ? `최대 ${max}장` : modelValue.length ? `${label} 더 추가` : `${label} 올리기`
      }}</span>
      <span class="caption">JPEG·PNG·WebP · {{ capture ? '카메라로 바로 찍거나 ' : '' }}앨범에서 선택 · 최대 {{ max }}장</span>
    </label>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.previews {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: var(--s-xs);
}
.pv {
  position: relative;
  aspect-ratio: 1;
  background: var(--surface-card);
}
.pv img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rm {
  position: absolute;
  right: 0;
  top: 0;
  min-height: 36px;
  min-width: 48px;
  border: 0;
  background: var(--surface-dark);
  color: var(--on-dark);
  font: var(--t-caption);
  font-weight: 700;
  cursor: pointer;
}
.drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-xxs);
  min-height: 128px;
  padding: var(--s-md);
  border: 1px dashed var(--hairline-strong);
  background: var(--surface-soft);
  text-align: center;
  cursor: pointer;
}
.drop:has(input:focus-visible) {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.drop.disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.invalid .drop {
  border: 2px solid var(--error);
}
.plus {
  font: var(--t-display-sm);
  color: var(--primary);
  line-height: 1;
}
</style>
