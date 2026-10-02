import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';

/**
 * 라우트 meta.permission = 진입 권한(하나라도 있으면). research R22 — 서버 권한 코드와 같다.
 * 권한 없음: 리다이렉트하지 않고 같은 URL 에 G0 블록(FR-003). 미로그인/비회원: 로그인으로(돌아올 경로 보존).
 */
declare module 'vue-router' {
  interface RouteMeta {
    permission?: string[];
    screen?: string;
    title?: string;
    public?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { public: true, title: '홈' } },
  {
    path: '/manual',
    name: 'manual',
    component: () => import('@/views/help/ManualView.vue'),
    meta: { public: true, title: '사용자 매뉴얼' },
  },
  {
    path: '/guidelines',
    name: 'guidelines',
    component: () => import('@/views/help/GuidelinesView.vue'),
    meta: { public: true, title: '이용 가이드라인' },
  },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true, title: '로그인' } },
  {
    path: '/account/password',
    name: 'password',
    component: () => import('@/views/account/PasswordChangeView.vue'),
    meta: { title: '비밀번호 변경' },
  },
  {
    path: '/notifications',
    name: 'notifications',
    component: () => import('@/views/NotificationsView.vue'),
    meta: { permission: ['notification.read.own'], title: '알림' },
  },

  {
    path: '/analysis',
    name: 'S2',
    component: () => import('@/views/S2AnalysisView.vue'),
    meta: { permission: ['analysis.create'], screen: 'S2', title: '하자 분석', public: true },
  },
  {
    path: '/purchase',
    name: 'S1',
    component: () => import('@/views/S1PurchaseView.vue'),
    meta: { permission: ['entitlement.purchase'], screen: 'S1', title: '분석 이용권' },
  },

  {
    path: '/records',
    name: 'S3-list',
    component: () => import('@/views/S3RecordListView.vue'),
    meta: { permission: ['record.create'], screen: 'S3', title: '현장 기록' },
  },
  {
    path: '/records/new',
    name: 'S3-new',
    component: () => import('@/views/S3FieldRecordView.vue'),
    meta: { permission: ['record.create'], screen: 'S3', title: '현장 기록 작성' },
  },
  {
    path: '/records/:recordId',
    name: 'S3',
    component: () => import('@/views/S3FieldRecordView.vue'),
    meta: { permission: ['record.create'], screen: 'S3', title: '현장 기록' },
  },
  {
    path: '/me/assignments',
    name: 'S7B',
    component: () => import('@/views/S7BMyAssignmentsView.vue'),
    meta: { permission: ['schedule.read.assigned'], screen: 'S7B', title: '내 배정 점검' },
  },

  {
    path: '/verification',
    name: 'S4',
    component: () => import('@/views/S4ExpertVerifyView.vue'),
    meta: { permission: ['verification.read'], screen: 'S4', title: '전문가 검증' },
  },
  {
    path: '/expert-inbox',
    name: 'S8B',
    component: () => import('@/views/S8BExpertInboxView.vue'),
    meta: { permission: ['expert_attempt.respond'], screen: 'S8B', title: '점검 요청' },
  },

  {
    path: '/buildings/history',
    name: 'S5',
    component: () => import('@/views/S5BuildingHistoryView.vue'),
    meta: { permission: ['building.history.read'], screen: 'S5', title: '건물 이력' },
  },
  {
    path: '/schedules',
    name: 'S7A',
    component: () => import('@/views/S7AScheduleBoardView.vue'),
    meta: { permission: ['schedule.manage'], screen: 'S7A', title: '정기점검 일정' },
  },
  {
    path: '/buildings/:buildingId/schedules',
    redirect: (to) => ({ path: '/schedules', query: { buildingId: to.params.buildingId as string } }),
  },
  {
    path: '/expert-requests',
    name: 'S8A-list',
    component: () => import('@/views/S8AExpertRequestListView.vue'),
    meta: { permission: ['expert_request.create'], screen: 'S8A', title: '전문가 점검 요청' },
  },
  {
    path: '/expert-requests/new',
    name: 'S8A-new',
    component: () => import('@/views/S8AExpertRequestView.vue'),
    meta: { permission: ['expert_request.create'], screen: 'S8A', title: '전문가 점검 요청' },
  },
  {
    path: '/expert-requests/:expReqId',
    name: 'S8A',
    component: () => import('@/views/S8AExpertRequestView.vue'),
    meta: { permission: ['expert_request.create'], screen: 'S8A', title: '전문가 점검 요청' },
  },

  {
    path: '/org/priority',
    name: 'S6',
    component: () => import('@/views/S6PriorityDashboardView.vue'),
    meta: { permission: ['org.dashboard.read'], screen: 'S6', title: '유지관리 우선순위' },
  },

  {
    path: '/admin',
    component: () => import('@/views/admin/AdminLayout.vue'),
    meta: {
      permission: [
        'admin.users.manage',
        'building_access.grant',
        'permission_request.resolve',
        'admin.constants.manage',
        'admin.notices.manage',
      ],
      screen: 'ADMIN',
      title: '관리',
    },
    children: [
      {
        path: '',
        redirect: () => {
          const s = useSession();
          if (s.can(['admin.users.manage', 'building_access.grant'])) return '/admin/users';
          if (s.can('permission_request.resolve')) return '/admin/permission-requests';
          if (s.can(['admin.constants.manage', 'admin.notices.manage'])) return '/admin/constants';
          return '/admin/users';
        },
      },
      {
        path: 'users',
        name: 'admin-users',
        component: () => import('@/views/admin/AdminUsersView.vue'),
        meta: { permission: ['admin.users.manage', 'building_access.grant'], screen: 'ADMIN', title: '계정·권한' },
      },
      {
        path: 'permission-requests',
        name: 'admin-permreq',
        component: () => import('@/views/admin/AdminPermissionRequestsView.vue'),
        meta: { permission: ['permission_request.resolve'], screen: 'ADMIN', title: '권한 요청' },
      },
      {
        path: 'rbac',
        name: 'admin-rbac',
        component: () => import('@/views/admin/AdminRbacMatrixView.vue'),
        meta: { permission: ['admin.rbac.manage', 'admin.users.manage', 'building_access.grant'], screen: 'ADMIN', title: '역할-권한' },
      },
      {
        path: 'constants',
        name: 'admin-constants',
        component: () => import('@/views/admin/AdminConstantsView.vue'),
        meta: { permission: ['admin.constants.manage', 'admin.notices.manage'], screen: 'ADMIN', title: '기준값·고지' },
      },
      {
        path: 'audit',
        name: 'admin-audit',
        component: () => import('@/views/admin/AdminAuditView.vue'),
        meta: { permission: ['admin.users.manage', 'building_access.grant'], screen: 'ADMIN', title: '감사 로그' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { public: true, title: '없는 화면' },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (to, _from, saved) => saved ?? (to.hash ? { el: to.hash, top: 88 } : { top: 0 }),
});

router.beforeEach(async (to) => {
  const session = useSession();
  const ui = useUi();
  if (!session.loaded) await session.load();
  ui.forbidden = null;

  if (session.me?.mustChangePassword && to.name !== 'password' && to.name !== 'login') {
    return { name: 'password', query: { returnTo: to.fullPath } };
  }
  // meta 는 matched 레코드가 병합된 값(자식이 부모를 덮는다)
  const need = to.meta.permission;
  if (!need?.length || session.can(need)) return true;
  if (!session.loggedIn) return { name: 'login', query: { returnTo: to.fullPath } };
  // FR-003 — 같은 URL 에 G0 블록
  ui.forbidden = { screen: to.meta.screen ?? '', title: to.meta.title ?? '' };
  return true;
});

router.afterEach((to) => {
  document.title = `${to.meta.title ? `${to.meta.title} · ` : ''}Buildcare AI`;
});

/** 메뉴(서버 me.menu) → 라우트 */
export const MENU: Record<string, { to: string; label: string }> = {
  S2: { to: '/analysis', label: '하자 분석' },
  S1: { to: '/purchase', label: '이용권' },
  S7B: { to: '/me/assignments', label: '내 배정 점검' },
  S3: { to: '/records', label: '현장 기록' },
  S4: { to: '/verification', label: '전문가 검증' },
  S8B: { to: '/expert-inbox', label: '점검 요청' },
  S5: { to: '/buildings/history', label: '건물 이력' },
  S7A: { to: '/schedules', label: '정기점검' },
  S8A: { to: '/expert-requests', label: '전문가 연결' },
  S6: { to: '/org/priority', label: '유지관리 우선순위' },
  ADMIN: { to: '/admin', label: '관리' },
};
