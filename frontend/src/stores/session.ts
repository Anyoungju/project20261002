import { defineStore } from 'pinia';
import { api, get, post } from '@/api/client';

export interface Me {
  userId: number;
  isGuest: boolean;
  nameMasked: string;
  emailMasked: string;
  roles: string[];
  permissions: string[];
  orgId: number | null;
  menu: string[];
  mustChangePassword: boolean;
  guestLinkable?: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  guest: '비회원',
  general: '일반 사용자',
  facility: '시설관리자',
  building: '건물관리자',
  enterprise: '기업 관리자',
  expert: '전문가',
  operator: '운영자',
};

/** research R22 — 메뉴·버튼은 서버가 준 permissions 로만 판단(역할 이름으로 분기하지 않는다) */
export const useSession = defineStore('session', {
  state: () => ({ me: null as Me | null, loaded: false, guestLinkable: false }),
  getters: {
    loggedIn: (s) => !!s.me && !s.me.isGuest,
    isGuest: (s) => !s.me || s.me.isGuest,
    roleLabels: (s) => (s.me?.roles ?? []).map((r) => ROLE_LABEL[r] ?? r),
  },
  actions: {
    can(code: string | string[]): boolean {
      const set = new Set(this.me?.permissions ?? GUEST_DEFAULT);
      return (Array.isArray(code) ? code : [code]).some((c) => set.has(c));
    },
    async load() {
      try {
        const me = await api<Me>('/api/auth/me', { handle401: true });
        this.me = me;
        this.guestLinkable = !!me.guestLinkable;
      } catch {
        this.me = null;
      } finally {
        this.loaded = true;
      }
    },
    async login(email: string, password: string) {
      const me = await api<Me>('/api/auth/login', { method: 'POST', body: { email, password }, handle401: true });
      this.me = me;
      this.guestLinkable = !!me.guestLinkable;
      this.loaded = true;
      return me;
    },
    async logout() {
      await post('/api/auth/logout').catch(() => undefined);
      this.me = null;
      this.guestLinkable = false;
      await this.load();
    },
    async refresh() {
      await this.load();
    },
  },
});

/** 아직 기기 계정이 없는 비회원도 S2 는 쓸 수 있다(FR-120) */
const GUEST_DEFAULT = ['analysis.create', 'analysis.read.own', 'entitlement.read.own'];

export async function fetchNotifications() {
  return get<{ unreadCount: number; items: any[] }>('/api/me/notifications');
}
