<script setup lang="ts">
/** 상단 내비 — 메뉴는 서버 me.menu(권한에서 유도, FR-001). 데스크톱 nav-link · 모바일 햄버거(스타일가이드 §09) */
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useSession, fetchNotifications } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { MENU } from '@/router';
import BrandMark from './BrandMark.vue';

const session = useSession();
const ui = useUi();
const route = useRoute();
const router = useRouter();
const open = ref(false);

const items = computed(() => {
  const menu = session.me?.menu ?? ['S2'];
  return menu.map((k) => ({ key: k, ...MENU[k] })).filter((x) => x.to);
});
watch(
  () => route.fullPath,
  () => (open.value = false),
);

let timer: ReturnType<typeof setInterval> | null = null;
async function poll() {
  if (!session.can('notification.read.own')) {
    ui.unread = 0;
    return;
  }
  try {
    ui.unread = (await fetchNotifications()).unreadCount;
  } catch {
    /* 무시 */
  }
}
onMounted(() => {
  poll();
  timer = setInterval(poll, 60_000);
});
onBeforeUnmount(() => timer && clearInterval(timer));
watch(() => session.me?.userId, poll);

async function logout() {
  await session.logout();
  router.push('/');
}
const isActive = (to: string) => route.path === to || route.path.startsWith(to + '/');
</script>

<template>
  <header class="app-header">
    <div class="container bar">
      <RouterLink to="/" class="brand" aria-label="Buildcare AI 홈">
        <BrandMark />
        <span class="name">Buildcare AI</span>
      </RouterLink>

      <nav class="nav" aria-label="주 메뉴">
        <RouterLink v-for="i in items" :key="i.key" :to="i.to" class="nav-link" :class="{ active: isActive(i.to) }">{{
          i.label
        }}</RouterLink>
      </nav>

      <div class="tools">
        <RouterLink to="/manual" class="help-link desktop" :class="{ active: isActive('/manual') || isActive('/guidelines') }"
          >도움말</RouterLink
        >
        <RouterLink v-if="session.can('notification.read.own')" to="/notifications" class="icon-btn" :aria-label="`알림 ${ui.unread}건`">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2 16a2 2 0 0 0 4 0"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            />
          </svg>
          <span v-if="ui.unread" class="dot">{{ ui.unread > 99 ? '99+' : ui.unread }}</span>
        </RouterLink>
        <template v-if="session.loggedIn">
          <span class="who">
            <b>{{ session.me?.nameMasked }}</b>
            <span class="caption">{{ session.roleLabels.join(' · ') }}</span>
          </span>
          <button type="button" class="link-btn desktop" @click="logout">로그아웃</button>
        </template>
        <RouterLink v-else :to="{ path: '/login', query: { returnTo: route.fullPath } }" class="login-link desktop">로그인</RouterLink>
        <button
          type="button"
          class="icon-btn burger"
          :aria-expanded="open"
          aria-controls="mobile-menu"
          aria-label="메뉴"
          @click="open = !open"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path :d="open ? 'M5 5l14 14M19 5L5 19' : 'M3 6h18M3 12h18M3 18h18'" stroke="currentColor" stroke-width="2" />
          </svg>
        </button>
      </div>
    </div>
    <div v-if="open" id="mobile-menu" class="mobile">
      <nav class="container" aria-label="모바일 메뉴">
        <RouterLink v-for="i in items" :key="i.key" :to="i.to" class="m-link" :class="{ active: isActive(i.to) }"
          >{{ i.label }}<span aria-hidden="true">›</span></RouterLink
        >
        <RouterLink to="/manual" class="m-link">사용자 매뉴얼<span aria-hidden="true">›</span></RouterLink>
        <RouterLink to="/guidelines" class="m-link">이용 가이드라인<span aria-hidden="true">›</span></RouterLink>
        <div class="m-foot">
          <template v-if="session.loggedIn">
            <span class="caption">{{ session.me?.nameMasked }} · {{ session.roleLabels.join(' · ') }}</span>
            <button type="button" class="m-link as-btn" @click="logout">로그아웃<span aria-hidden="true">›</span></button>
          </template>
          <RouterLink v-else :to="{ path: '/login', query: { returnTo: route.fullPath } }" class="m-link"
            >로그인<span aria-hidden="true">›</span></RouterLink
          >
        </div>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--canvas);
  border-bottom: 1px solid var(--hairline);
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--s-lg);
  height: 64px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--s-sm);
  color: var(--ink);
  text-decoration: none;
  flex: none;
}
.brand:hover {
  text-decoration: none;
}
.name {
  font: var(--t-title-md);
  letter-spacing: 0;
}
.nav {
  display: flex;
  gap: var(--s-lg);
  flex: 1;
  overflow-x: auto;
}
.nav-link {
  display: inline-flex;
  align-items: center;
  min-height: 64px;
  font: var(--t-nav);
  color: var(--body);
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  text-decoration: none;
}
.nav-link:hover {
  color: var(--ink);
  text-decoration: none;
}
.nav-link.active {
  color: var(--ink);
  font-weight: 700;
  border-bottom-color: var(--ink);
}
.tools {
  display: flex;
  align-items: center;
  gap: var(--s-sm);
  margin-left: auto;
  flex: none;
}
.icon-btn {
  position: relative;
  width: var(--touch);
  height: var(--touch);
  border-radius: var(--r-full);
  border: 1px solid var(--hairline-strong);
  background: var(--canvas);
  color: var(--ink);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.dot {
  position: absolute;
  top: -4px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  background: var(--error);
  color: var(--on-primary);
  font: var(--t-caption);
  font-weight: 700;
  display: grid;
  place-items: center;
}
.who {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  font: var(--t-body-sm);
  color: var(--ink);
}
.who b {
  font-weight: 700;
}
.link-btn {
  min-height: var(--touch);
  padding: 0 var(--s-sm);
  border: 0;
  background: none;
  font: var(--t-nav);
  color: var(--body);
  cursor: pointer;
}
.login-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch);
  padding: 0 var(--s-lg);
  background: var(--primary);
  color: var(--on-primary);
  font: var(--t-button);
  text-decoration: none;
}
.help-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch);
  padding: 0 var(--s-sm);
  font: var(--t-nav);
  color: var(--body);
  text-decoration: none;
}
.help-link.active {
  color: var(--ink);
  font-weight: 700;
}
.burger {
  display: none;
}
.mobile {
  border-top: 1px solid var(--hairline);
  background: var(--canvas);
}
.m-link {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 56px;
  padding: 0;
  border-bottom: 1px solid var(--hairline);
  color: var(--ink);
  font: var(--t-title-sm);
  text-decoration: none;
}
.m-link.active {
  color: var(--primary);
}
.m-link.as-btn {
  width: 100%;
  background: none;
  border-left: 0;
  border-right: 0;
  border-top: 0;
  cursor: pointer;
  text-align: left;
}
.m-foot {
  padding: var(--s-md) 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
@media (max-width: 1023px) {
  .nav,
  .who,
  .desktop {
    display: none;
  }
  .burger {
    display: grid;
  }
  .bar {
    height: 56px;
  }
}
</style>
