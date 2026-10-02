<script setup lang="ts">
/** FR-120a — 로그인 직후 인라인 블록(모달 아님): 이 기기의 비회원 분석 결과를 계정에 연결 */
import { ref } from 'vue';
import { post, errorMessage } from '@/api/client';
import { useSession } from '@/stores/session';
import BaseButton from '@/components/base/BaseButton.vue';
import AlertBox from '@/components/base/AlertBox.vue';

const emit = defineEmits<{ done: [] }>();
const session = useSession();
const busy = ref(false);
const result = ref<{ linkedCaseCount: number; freeTrialRemaining: number | null } | null>(null);
const err = ref('');

async function link() {
  busy.value = true;
  err.value = '';
  try {
    result.value = await post('/api/auth/link-guest');
    session.guestLinkable = false;
    await session.refresh();
  } catch (e) {
    err.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="link" aria-labelledby="gl-title">
    <template v-if="!result">
      <p id="gl-title" class="title-sm">이 기기에서 받은 비회원 분석 결과가 있습니다</p>
      <p class="body-sm">계정에 연결하면 결과를 계속 볼 수 있습니다. 비회원으로 쓴 무료 체험 횟수는 계정의 무료 체험 횟수에 합산됩니다.</p>
      <p v-if="err" class="body-sm" style="color: var(--error-text)">{{ err }}</p>
      <div class="row">
        <BaseButton :busy="busy" @click="link">이 기기의 분석 결과 연결</BaseButton>
        <BaseButton variant="secondary" @click="emit('done')">나중에</BaseButton>
      </div>
    </template>
    <template v-else>
      <AlertBox tone="ok" title="연결했습니다">
        분석 {{ result.linkedCaseCount }}건을 계정에 연결했습니다.
        <template v-if="result.freeTrialRemaining != null"> 남은 무료 체험 {{ result.freeTrialRemaining }}회.</template>
      </AlertBox>
      <BaseButton block @click="emit('done')">계속</BaseButton>
    </template>
  </section>
</template>

<style scoped>
.link {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  padding: var(--s-md);
  border: 1px solid var(--hairline-strong);
  border-left: 4px solid var(--primary);
}
</style>
