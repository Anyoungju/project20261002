<script setup lang="ts">
/**
 * 관리 화면 저장·조회 실패 표시.
 * 네트워크·서버 오류 → RetryBox [다시 시도] · 게이트 → C2 · 규칙 거부(4xx) → 사유 안내(같은 요청을 다시 보내도 결과가 같다)
 */
import { computed } from 'vue';
import { ApiError, GateBlockError, NetworkError, errorMessage } from '@/api/client';
import RetryBox from '@/components/base/RetryBox.vue';
import AlertBox from '@/components/base/AlertBox.vue';
import C2GateBlock from '@/components/common/C2GateBlock.vue';

const props = defineProps<{ error: unknown; busy?: boolean; keepsInput?: boolean; title?: string }>();
const emit = defineEmits<{ retry: [] }>();
const retryable = computed(
  () =>
    props.error instanceof NetworkError ||
    (props.error instanceof ApiError && props.error.status >= 500) ||
    !(props.error instanceof ApiError || props.error instanceof GateBlockError),
);
</script>

<template>
  <C2GateBlock v-if="error instanceof GateBlockError" :block="error.block" compact />
  <RetryBox v-else-if="retryable" :message="errorMessage(error)" :keeps-input="keepsInput" :busy="busy" @retry="emit('retry')" />
  <AlertBox v-else tone="danger" :title="title ?? '처리하지 못했습니다'">{{ errorMessage(error) }}</AlertBox>
</template>
