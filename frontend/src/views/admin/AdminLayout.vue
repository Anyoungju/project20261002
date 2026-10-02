<script setup lang="ts">
/**
 * 관리 화면 틀 — 하위 탭은 권한 코드로만 보인다(R22). 권한 코드는 router meta 와 같다.
 */
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useSession } from '@/stores/session';

const session = useSession();
const route = useRoute();

const TABS = [
  { to: '/admin/users', name: 'admin-users', label: '계정·권한', perm: ['admin.users.manage', 'building_access.grant'] },
  { to: '/admin/permission-requests', name: 'admin-permreq', label: '권한 요청', perm: ['permission_request.resolve'] },
  { to: '/admin/rbac', name: 'admin-rbac', label: '역할-권한', perm: ['admin.rbac.manage', 'admin.users.manage', 'building_access.grant'] },
  { to: '/admin/constants', name: 'admin-constants', label: '기준값·고지', perm: ['admin.constants.manage'] },
  { to: '/admin/audit', name: 'admin-audit', label: '감사 로그', perm: ['admin.users.manage', 'building_access.grant'] },
];
const tabs = computed(() => TABS.filter((t) => session.can(t.perm)));
</script>

<template>
  <div class="container page">
    <div class="page-head admin-head">
      <div>
        <p class="eyebrow">관리</p>
        <h1 class="display-md">{{ route.meta.title ?? '관리' }}</h1>
      </div>
    </div>
    <nav class="tabs" aria-label="관리 메뉴">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="tab" :aria-current="route.name === t.name ? 'page' : undefined">
        {{ t.label }}
      </RouterLink>
    </nav>
    <div class="admin-body">
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
.admin-head {
  margin-bottom: var(--s-md);
}
.tabs {
  display: flex;
  gap: var(--s-lg);
  border-bottom: 1px solid var(--hairline);
  overflow-x: auto;
  scrollbar-width: thin;
}
.tab {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: var(--touch);
  padding: 0 var(--s-xxs);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--muted);
  font: var(--t-nav);
  text-decoration: none;
}
.tab:hover {
  color: var(--ink);
  text-decoration: none;
}
.tab[aria-current='page'] {
  color: var(--ink);
  font-weight: 700;
  border-bottom-color: var(--ink);
}
.admin-body {
  margin-top: var(--s-lg);
}
</style>
