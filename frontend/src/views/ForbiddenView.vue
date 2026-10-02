<script setup lang="ts">
/** FR-003 — 권한 밖 화면 직접 접근: 같은 URL 에 G0 블록 + [권한 요청 보내기] */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import G0Block from '@/components/common/G0Block.vue';

const props = defineProps<{ screen: string; title: string }>();
const route = useRoute();
const buildingId = computed(() => (route.query.buildingId ? Number(route.query.buildingId) : null));
</script>

<template>
  <div class="container page">
    <div class="page-head">
      <div>
        <p class="eyebrow">접근 권한 안내</p>
        <h1 class="display-sm">{{ props.title }}</h1>
      </div>
    </div>
    <G0Block :screen="props.screen" :building-id="buildingId" reason="현재 역할에 이 화면을 쓸 권한이 없습니다" />
  </div>
</template>
