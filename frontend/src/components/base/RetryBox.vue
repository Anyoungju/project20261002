<script setup lang="ts">
/** FR-102 — 실패한 영역에서 [다시 시도]. 입력값은 이 기기에 남아 있다는 문구 */
import BaseButton from './BaseButton.vue';
defineProps<{ message: string; keepsInput?: boolean; busy?: boolean }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="retry" role="alert">
    <p class="title-sm">{{ keepsInput ? '저장하지 못했습니다 - 입력한 내용은 이 기기에 남아 있습니다' : '불러오지 못했습니다' }}</p>
    <p class="body-sm">{{ message }}</p>
    <BaseButton variant="secondary" size="sm" :busy="busy" @click="emit('retry')">다시 시도</BaseButton>
  </div>
</template>

<style scoped>
.retry {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--s-xs);
  padding: var(--s-md);
  border: 1px solid var(--hairline-strong);
  border-left: 4px solid var(--ink);
  background: var(--surface-soft);
  margin: var(--s-sm) 0;
}
</style>
