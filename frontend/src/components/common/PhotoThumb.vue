<script setup lang="ts">
/** 서명 URL 사진 (FR-091 · FR-101 대체 텍스트 "하자 종류 - 위치 - 촬영일"). 만료되면 URL 재발급 */
import { ref, watch } from 'vue';
import { get } from '@/api/client';

const props = withDefaults(
  defineProps<{
    photo: { kind: 'analysis' | 'record'; photoId: number; url: string; alt: string };
    ratio?: string;
    fit?: 'cover' | 'contain';
  }>(),
  { ratio: '4 / 3', fit: 'cover' },
);
const src = ref(props.photo.url);
const failed = ref(false);
let retried = false;
watch(
  () => props.photo.url,
  (u) => {
    src.value = u;
    retried = false;
    failed.value = false;
  },
);
async function onError() {
  if (retried) {
    failed.value = true;
    return;
  }
  retried = true;
  try {
    const r = await get<{ url: string }>(`/api/photos/${props.photo.kind}/${props.photo.photoId}/url`);
    src.value = r.url;
  } catch {
    failed.value = true;
  }
}
</script>

<template>
  <figure class="thumb" :style="{ aspectRatio: ratio }">
    <img v-if="!failed" :src="src" :alt="photo.alt" loading="lazy" :style="{ objectFit: fit }" @error="onError" />
    <figcaption v-else class="fail">
      사진을 불러올 수 없습니다<br /><span class="caption">{{ photo.alt }}</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.thumb {
  margin: 0;
  background: var(--surface-card);
  overflow: hidden;
  width: 100%;
}
.thumb img {
  width: 100%;
  height: 100%;
}
.fail {
  height: 100%;
  display: grid;
  place-content: center;
  text-align: center;
  font: var(--t-body-sm);
  color: var(--muted);
  padding: var(--s-sm);
}
</style>
