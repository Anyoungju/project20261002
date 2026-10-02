<script setup lang="ts">
/** 임시 비밀번호 — 한 번만 인라인으로 보인다(모달 아님). [확인했습니다] 뒤에는 다시 볼 수 없다 */
import { ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';

defineProps<{ password: string; title: string }>();
const emit = defineEmits<{ done: [] }>();
const copied = ref(false);
async function copy(pw: string) {
  try {
    await navigator.clipboard.writeText(pw);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <section class="tp" role="status" aria-live="polite">
    <p class="title-sm">{{ title }}</p>
    <p class="body-sm">
      임시 비밀번호는 지금 한 번만 보입니다. 사용자에게 안전하게 전달하세요. 첫 로그인 때 비밀번호를 바꾸도록 안내됩니다.
    </p>
    <p class="pw mono" aria-label="임시 비밀번호">{{ password }}</p>
    <div class="row">
      <BaseButton variant="secondary" size="sm" @click="copy(password)">{{ copied ? '복사함' : '복사' }}</BaseButton>
      <BaseButton size="sm" @click="emit('done')">확인했습니다</BaseButton>
    </div>
  </section>
</template>

<style scoped>
.tp {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  padding: var(--s-md);
  border: 1px solid var(--hairline-strong);
  border-left: 4px solid var(--primary);
  background: var(--canvas);
}
.pw {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: 1px;
  padding: var(--s-xs) var(--s-sm);
  background: var(--surface-soft);
  word-break: break-all;
}
</style>
