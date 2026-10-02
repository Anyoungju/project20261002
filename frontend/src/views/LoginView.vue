<script setup lang="ts">
/** 로그인 — returnTo 복귀(FR-102 · FR-023), 423 잠금 안내, 비회원 결과 연결 제안(FR-120a) */
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '@/stores/session';
import { ApiError, errorMessage } from '@/api/client';
import BaseButton from '@/components/base/BaseButton.vue';
import GuestLinkPrompt from '@/components/auth/GuestLinkPrompt.vue';

const session = useSession();
const route = useRoute();
const router = useRouter();
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');
const locked = ref(false);
const showLink = ref(false);
const returnTo = computed(() => {
  const r = String(route.query.returnTo ?? '');
  return r.startsWith('/') && !r.startsWith('//') && !r.startsWith('/login') ? r : '';
});
const expired = computed(() => route.query.expired === '1');

// 시연 환경 전용(VITE_DEMO_ACCOUNTS=1) — 이메일만 채운다. 비밀번호는 안내받은 값을 직접 입력
const showDemo = import.meta.env.VITE_DEMO_ACCOUNTS === '1';
const DEMO = [
  { email: 'general@dev.local', role: '일반 사용자', what: '하자 분석 · 이용권' },
  { email: 'facility@dev.local', role: '시설관리자', what: '현장 기록 · 내 배정 점검' },
  { email: 'building@dev.local', role: '건물관리자', what: '건물 이력 · 정기점검 · 전문가 연결' },
  { email: 'expert@dev.local', role: '전문가', what: '검증 · 점검 요청 수락' },
  { email: 'enterprise@dev.local', role: '기업 관리자', what: '유지관리 우선순위' },
  { email: 'operator@dev.local', role: '운영자', what: '계정·권한 관리' },
];
const pwInput = ref<HTMLInputElement | null>(null);
function pick(e: string) {
  email.value = e;
  error.value = '';
  pwInput.value?.focus();
}

function home() {
  // 로그인 후 기본 화면은 역할별 "오늘 할 일" 홈
  return '/';
}

async function submit() {
  if (busy.value) return;
  error.value = '';
  locked.value = false;
  busy.value = true;
  try {
    const me = await session.login(email.value.trim(), password.value);
    password.value = '';
    if (me.mustChangePassword) {
      router.replace({ name: 'password', query: { returnTo: returnTo.value || home() } });
      return;
    }
    if (me.guestLinkable) {
      showLink.value = true;
      return;
    }
    router.replace(returnTo.value || home());
  } catch (e) {
    if (e instanceof ApiError && e.status === 423) locked.value = true;
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
function done() {
  router.replace(returnTo.value || home());
}
</script>

<template>
  <div class="container page login">
    <div class="card">
      <p class="eyebrow">다시 오신 걸 환영해요</p>
      <h1 class="display-sm">로그인</h1>
      <p v-if="expired" class="body-sm notice">세션이 만료되었습니다. 다시 로그인하면 보던 화면과 입력한 내용으로 돌아갑니다.</p>
      <p v-else-if="returnTo" class="body-sm notice">로그인하면 이어서 진행합니다.</p>

      <GuestLinkPrompt v-if="showLink" @done="done" />

      <form v-else class="stack" novalidate @submit.prevent="submit">
        <div class="field">
          <label for="email">이메일</label>
          <input id="email" v-model="email" class="input" type="email" autocomplete="username" required :aria-invalid="!!error" />
        </div>
        <div class="field">
          <label for="password">비밀번호</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            required
            :aria-invalid="!!error"
          />
        </div>
        <p v-if="error" class="err" role="alert">{{ error }}</p>
        <p v-if="locked" class="body-sm muted">보안을 위해 연속 실패 시 잠시 잠깁니다. 시간이 지나면 다시 시도할 수 있습니다.</p>
        <BaseButton type="submit" block :busy="busy" :disabled="!email || !password">로그인</BaseButton>
      </form>

      <section v-if="showDemo && !showLink" class="demo" aria-labelledby="demo-title">
        <p id="demo-title" class="title-sm">시연 계정으로 둘러보기</p>
        <p class="caption">역할을 고르면 이메일이 채워져요. 비밀번호는 안내받은 시연용 비밀번호를 입력하세요.</p>
        <ul class="demo-list">
          <li v-for="d in DEMO" :key="d.email">
            <button type="button" class="demo-item" :aria-pressed="email === d.email" @click="pick(d.email)">
              <b>{{ d.role }}</b>
              <span class="caption">{{ d.what }}</span>
            </button>
          </li>
        </ul>
      </section>

      <div class="divider"></div>
      <p class="body-sm">
        로그인 없이도 <RouterLink to="/analysis">하자 사진 무료 체험 분석</RouterLink>을 이용할 수 있습니다. 이용권 구매부터 로그인이
        필요합니다.
      </p>
      <p class="caption" style="margin-top: 8px">계정은 운영자 또는 소속 기업 관리자가 발급합니다.</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  justify-content: center;
}
.card {
  width: 100%;
  max-width: 440px;
  border: 1px solid var(--hairline);
  padding: var(--s-xl);
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}
.eyebrow {
  font: var(--t-label);
}
.notice {
  background: var(--surface-soft);
  padding: var(--s-sm) var(--s-md);
  border-left: 4px solid var(--ink);
}
.demo {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  padding-top: var(--s-md);
  border-top: 1px solid var(--hairline);
}
.demo-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-xs);
}
.demo-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  min-height: 56px;
  padding: var(--s-xs) var(--s-sm);
  border: 1px solid var(--hairline-strong);
  background: var(--canvas);
  color: var(--ink);
  font: var(--t-body-sm);
  text-align: left;
  cursor: pointer;
}
.demo-item[aria-pressed='true'] {
  border: 2px solid var(--primary);
  padding: calc(var(--s-xs) - 1px) calc(var(--s-sm) - 1px);
}
.err {
  font: var(--t-body-sm);
  color: var(--error-text);
}
@media (max-width: 767px) {
  .card {
    border: 0;
    padding: 0;
  }
}
</style>
