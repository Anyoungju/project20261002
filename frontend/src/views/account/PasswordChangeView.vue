<script setup lang="ts">
/** R22 — 비밀번호 변경(임시 비밀번호 첫 로그인 시 강제). 변경 시 다른 기기 세션은 끊긴다 */
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { post, errorMessage } from '@/api/client';
import { useSession } from '@/stores/session';
import BaseButton from '@/components/base/BaseButton.vue';
import AlertBox from '@/components/base/AlertBox.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();
const current = ref('');
const next = ref('');
const confirm = ref('');
const busy = ref(false);
const err = ref('');
const mismatch = computed(() => !!confirm.value && next.value !== confirm.value);

async function submit() {
  if (mismatch.value) return;
  busy.value = true;
  err.value = '';
  try {
    await post('/api/auth/password', { currentPassword: current.value, newPassword: next.value });
    await session.refresh();
    const r = String(route.query.returnTo ?? '/');
    router.replace(r.startsWith('/') ? r : '/');
  } catch (e) {
    err.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="container page" style="max-width: 520px">
    <h1 class="display-sm">비밀번호 변경</h1>
    <AlertBox v-if="session.me?.mustChangePassword" tone="info" title="임시 비밀번호로 로그인했습니다" style="margin-top: 16px"
      >계속하려면 새 비밀번호를 정해 주세요.</AlertBox
    >
    <form class="stack" style="margin-top: 24px" @submit.prevent="submit">
      <div class="field">
        <label for="cur">현재 비밀번호</label>
        <input id="cur" v-model="current" class="input" type="password" autocomplete="current-password" required />
      </div>
      <div class="field">
        <label for="new">새 비밀번호</label>
        <input
          id="new"
          v-model="next"
          class="input"
          type="password"
          autocomplete="new-password"
          required
          minlength="10"
          aria-describedby="pw-hint"
        />
        <span id="pw-hint" class="hint">10자 이상, 영문과 숫자를 함께</span>
      </div>
      <div class="field">
        <label for="new2">새 비밀번호 확인</label>
        <input id="new2" v-model="confirm" class="input" type="password" autocomplete="new-password" required :aria-invalid="mismatch" />
        <span v-if="mismatch" class="error-text">새 비밀번호가 서로 다릅니다</span>
      </div>
      <p v-if="err" class="error-text" role="alert" style="color: var(--error-text)">{{ err }}</p>
      <BaseButton type="submit" block :busy="busy" :disabled="!current || !next || mismatch">변경</BaseButton>
    </form>
  </div>
</template>
