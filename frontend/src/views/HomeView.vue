<script setup lang="ts">
/**
 * 홈 — 비회원: 서비스 소개 + 3단계 이용 방법. 로그인: 인사 + 역할별 "오늘 할 일"(권한 코드로만 판단) + 바로가기.
 */
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { get, api } from '@/api/client';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { MENU } from '@/router';
import BaseButton from '@/components/base/BaseButton.vue';
import BrandMark from '@/components/layout/BrandMark.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';

const session = useSession();
const ui = useUi();

interface Todo {
  key: string;
  title: string;
  count: number | null;
  desc: string;
  to: string;
  cta: string;
  tone: 'danger' | 'warn' | 'ok' | 'info';
}
const todos = ref<Todo[]>([]);
const loading = ref(false);

const DESC: Record<string, string> = {
  S2: '사진 한 장으로 균열·누수·결로의 가능한 원인과 대응방안을 확인해요.',
  S1: '무료 체험을 다 쓰면 건별 분석이나 월 구독을 선택해요.',
  S7B: '오늘 해야 할 점검과 지연된 점검을 모아 보여 드려요.',
  S3: '현장 점검·보수 결과를 사진과 함께 기록해요.',
  S4: 'AI 결과와 현장 기록을 나란히 보고 판정해요.',
  S8B: '건물관리자가 보낸 점검 요청을 확인하고 수락해요.',
  S5: '건물의 모든 이력과 반복되는 하자를 한눈에 봐요.',
  S7A: '정기점검 일정을 만들고 담당자를 배정해요.',
  S8A: '위험이 감지된 건에 맞는 전문가를 찾아 연결해요.',
  S6: '관리 건물 중 먼저 손봐야 할 곳을 알려 드려요.',
  ADMIN: '계정·역할·건물 권한과 운영 기준값을 관리해요.',
};
const shortcuts = computed(() => (session.me?.menu ?? ['S2']).map((k) => ({ key: k, ...MENU[k], desc: DESC[k] })));

const greeting = computed(() => {
  const h = new Date().getHours();
  const t = h < 11 ? '좋은 아침이에요' : h < 18 ? '안녕하세요' : '수고 많으셨어요';
  return `${session.me?.nameMasked ?? ''}님, ${t}`;
});

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function loadTodos() {
  if (!session.loggedIn) return;
  loading.value = true;
  const out: Todo[] = [];
  const can = (c: string) => session.can(c);
  const jobs: Array<Promise<void>> = [];

  if (can('schedule.read.assigned')) {
    jobs.push(
      safe(() => get('/api/me/assignments')).then((a: any) => {
        if (!a) return;
        if (a.rail.overdue)
          out.push({
            key: 'overdue',
            title: '기한이 지난 점검',
            count: a.rail.overdue,
            desc: '가장 먼저 처리해 주세요. 현장 기록을 저장하면 완료돼요.',
            to: '/me/assignments',
            cta: '지연 점검 보기',
            tone: 'danger',
          });
        if (a.rail.dataRequests)
          out.push({
            key: 'datareq',
            title: '전문가의 추가 사진 요청',
            count: a.rail.dataRequests,
            desc: '사진을 더 올리면 검증이 다시 진행돼요.',
            to: '/me/assignments',
            cta: '요청 보기',
            tone: 'warn',
          });
        out.push({
          key: 'assigned',
          title: '나에게 배정된 점검',
          count: a.rail.assigned,
          desc: a.rail.due ? `그중 ${a.rail.due}건은 기한이 다가와요.` : '배정된 점검 목록이에요.',
          to: '/me/assignments',
          cta: '배정 점검 열기',
          tone: 'info',
        });
      }),
    );
  }
  if (can('verification.read')) {
    jobs.push(
      safe(() => get<any[]>('/api/verification-items')).then((xs) => {
        if (!xs) return;
        const waiting = xs.filter((x) => x.status === 'waiting').length;
        out.push({
          key: 'verify',
          title: '검증을 기다리는 건',
          count: waiting,
          desc: 'AI 결과와 현장 판정이 달랐던 건이에요.',
          to: '/verification',
          cta: '검증 시작',
          tone: waiting ? 'warn' : 'ok',
        });
      }),
    );
  }
  if (can('expert_attempt.respond')) {
    jobs.push(
      safe(() => get<any[]>('/api/me/expert-attempts')).then((xs) => {
        if (!xs) return;
        const pending = xs.filter((x) => !x.response).length;
        if (pending)
          out.push({
            key: 'attempts',
            title: '응답할 점검 요청',
            count: pending,
            desc: '수락하면 연결이 확정되고 연락처가 공개돼요.',
            to: '/expert-inbox',
            cta: '요청 확인',
            tone: 'warn',
          });
      }),
    );
  }
  if (can('risk_notice.read') && can('expert_request.create')) {
    jobs.push(
      safe(() => get<any[]>('/api/risk-notices')).then((xs) => {
        if (!xs) return;
        const open = xs.filter((x) => x.open && !x.expReqId).length;
        out.push({
          key: 'risk',
          title: '전문가 점검이 필요한 위험 통지',
          count: open,
          desc: '위험이 감지된 하자예요. 전문가를 연결하거나 조치 없음으로 닫을 수 있어요.',
          to: '/expert-requests',
          cta: '위험 통지 보기',
          tone: open ? 'danger' : 'ok',
        });
      }),
    );
  }
  if (can('org.dashboard.read')) {
    jobs.push(
      safe(() => api('/api/org/dashboard', { handle401: true })).then((d: any) => {
        if (!d) {
          out.push({
            key: 'org',
            title: '기업 대시보드',
            count: null,
            desc: '라이선스를 확인해야 해요. 대시보드에서 안내를 확인하세요.',
            to: '/org/priority',
            cta: '대시보드 열기',
            tone: 'warn',
          });
          return;
        }
        out.push({
          key: 'org',
          title: '조치가 필요한 항목',
          count: d.summary.actionNeeded,
          desc: `관리 건물 ${d.buildings.length}곳 · 열린 위험 통지와 미완료 보수를 합친 수예요.`,
          to: '/org/priority',
          cta: '우선순위 보기',
          tone: d.summary.actionNeeded ? 'warn' : 'ok',
        });
      }),
    );
  }
  if (can('permission_request.resolve')) {
    jobs.push(
      safe(() => get<any[]>('/api/admin/permission-requests')).then((xs) => {
        if (xs?.length)
          out.push({
            key: 'permreq',
            title: '처리할 권한 요청',
            count: xs.length,
            desc: '동료가 화면 접근 권한을 요청했어요.',
            to: '/admin/permission-requests',
            cta: '요청 처리',
            tone: 'warn',
          });
      }),
    );
  }
  // 이용권 카드는 개인 사용자(일반 사용자)에게만 — 업무 역할에는 분석이 부가 기능이다
  if (can('analysis.create') && !can('building.list') && !can('verification.read') && !can('org.dashboard.read')) {
    jobs.push(
      safe(() => get('/api/me/entitlements')).then((e: any) => {
        if (!e) return;
        const remain = e.freeTrial?.remaining ?? 0;
        const paid = (e.paid ?? []).some((p: any) => p.usable);
        out.push({
          key: 'ent',
          title: paid ? '이용권으로 분석할 수 있어요' : remain ? '남은 무료 체험' : '분석 이용권이 필요해요',
          count: paid ? null : remain,
          desc: paid
            ? '사진을 올려 바로 분석을 받아 보세요.'
            : remain
              ? '사진 한 장으로 바로 분석해 보세요.'
              : '건별 분석 또는 월 구독으로 계속 이용할 수 있어요.',
          to: paid || remain ? '/analysis' : '/purchase?returnTo=/analysis',
          cta: paid || remain ? '분석하러 가기' : '이용권 보기',
          tone: paid || remain ? 'ok' : 'warn',
        });
      }),
    );
  }
  await Promise.all(jobs);
  const rank = { danger: 0, warn: 1, info: 2, ok: 3 } as const;
  todos.value = out.sort((a, b) => rank[a.tone] - rank[b.tone]);
  loading.value = false;
}

onMounted(loadTodos);

const toneLabel = (t: Todo['tone']) => (t === 'danger' ? '급해요' : t === 'warn' ? '확인 필요' : t === 'ok' ? '여유 있음' : '진행 중');
</script>

<template>
  <div>
    <!-- ===================================================== 로그인 사용자 -->
    <template v-if="session.loggedIn">
      <section class="container page">
        <div class="page-head">
          <div>
            <p class="eyebrow">{{ session.roleLabels.join(' · ') }}</p>
            <h1 class="display-md">{{ greeting }}</h1>
            <p class="body-md muted" style="margin-top: 8px">
              오늘 챙기면 좋을 일을 모았어요.<template v-if="ui.unread"> 읽지 않은 알림이 {{ ui.unread }}건 있어요.</template>
            </p>
          </div>
          <BaseButton v-if="ui.unread" variant="secondary" to="/notifications">알림 {{ ui.unread }}건 보기</BaseButton>
        </div>

        <h2 class="title-lg">오늘 할 일</h2>
        <div v-if="loading" class="grid-3 todo-grid">
          <p v-for="i in 3" :key="i" class="skeleton" style="height: 168px"></p>
        </div>
        <p v-else-if="!todos.length" class="empty" style="margin-top: 16px">
          지금 처리할 일이 없어요. 아래 바로가기에서 필요한 화면을 열어 보세요.
        </p>
        <ul v-else class="grid-3 todo-grid">
          <li v-for="t in todos" :key="t.key" class="todo" :class="`t-${t.tone}`">
            <div class="row-between">
              <StatusBadge :tone="t.tone === 'info' ? 'info' : t.tone" :label="toneLabel(t.tone)" />
              <span v-if="t.count != null" class="todo-count">{{ t.count }}<small>건</small></span>
            </div>
            <p class="title-md">{{ t.title }}</p>
            <p class="body-sm">{{ t.desc }}</p>
            <BaseButton :variant="t.tone === 'danger' || t.tone === 'warn' ? 'primary' : 'secondary'" size="sm" :to="t.to">{{
              t.cta
            }}</BaseButton>
          </li>
        </ul>

        <div class="row-between" style="margin-top: 48px">
          <h2 class="title-lg">바로가기</h2>
          <RouterLink to="/manual">처음이라면 사용자 매뉴얼 ›</RouterLink>
        </div>
        <ul class="grid-4 cards">
          <li v-for="c in shortcuts" :key="c.key">
            <RouterLink :to="c.to" class="card">
              <span class="title-md">{{ c.label }}</span>
              <span class="body-sm">{{ c.desc }}</span>
              <span class="more">열기 <span aria-hidden="true">›</span></span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>

    <!-- ===================================================== 비회원 -->
    <template v-else>
      <section class="hero">
        <div class="container hero-inner">
          <BrandMark :size="48" on-dark />
          <h1 class="display-xl hero-title">사진 한 장으로 시작하는<br />건물 관리</h1>
          <p class="hero-text">
            균열·누수·결로 사진을 올리면 가능한 원인과 대응방안을 바로 알려 드려요. 로그인 없이 무료로 3번 써 볼 수 있어요.
          </p>
          <div class="row">
            <BaseButton to="/analysis">무료로 사진 분석하기</BaseButton>
            <BaseButton variant="on-dark" to="/login">로그인</BaseButton>
          </div>
        </div>
      </section>

      <section class="container section">
        <p class="eyebrow">이용 방법</p>
        <h2 class="display-md">3단계면 충분해요</h2>
        <ol class="grid-3 steps">
          <li class="step">
            <span class="num">1</span>
            <p class="title-md">하자 사진 올리기</p>
            <p class="body-sm">휴대폰으로 하자 부위를 밝은 곳에서 찍어 올려요. 설명은 쓰지 않아도 괜찮아요.</p>
          </li>
          <li class="step">
            <span class="num">2</span>
            <p class="title-md">원인과 대응방안 확인</p>
            <p class="body-sm">가능성이 높은 원인부터 순서대로, 지금 할 수 있는 조치를 함께 보여 드려요.</p>
          </li>
          <li class="step">
            <span class="num">3</span>
            <p class="title-md">필요하면 전문가 점검</p>
            <p class="body-sm">위험해 보이면 바로 알려 드려요. 건물관리자는 조건에 맞는 전문가를 연결할 수 있어요.</p>
          </li>
        </ol>
      </section>

      <section class="container section">
        <p class="eyebrow">이런 분께 맞아요</p>
        <h2 class="display-md">관리 업무 전체를 이어 줘요</h2>
        <ul class="grid-4 cards">
          <li class="card static">
            <span class="title-md">집·사무실 사용자</span><span class="body-sm">하자가 위험한지 먼저 확인하고 싶을 때</span>
          </li>
          <li class="card static">
            <span class="title-md">시설관리자</span><span class="body-sm">현장 점검·보수 기록을 휴대폰으로 바로 남길 때</span>
          </li>
          <li class="card static">
            <span class="title-md">건물관리자</span><span class="body-sm">반복 하자와 정기점검, 전문가 연결을 한곳에서</span>
          </li>
          <li class="card static">
            <span class="title-md">관리회사·FM기업</span><span class="body-sm">여러 건물 중 먼저 손볼 곳을 정할 때</span>
          </li>
        </ul>
      </section>

      <section class="container section">
        <aside class="trust">
          <div class="row-between">
            <p class="title-sm">안심하고 쓰세요</p>
            <span class="row">
              <RouterLink to="/manual">사용자 매뉴얼 ›</RouterLink>
              <RouterLink to="/guidelines">이용 가이드라인 ›</RouterLink>
            </span>
          </div>
          <ul class="body-sm">
            <li>AI 결과는 사진만 보고 판단한 1차 참고용 정보예요. 법적·구조적 안전 판정을 대신하지 않아요.</li>
            <li>사진이 흐리거나 어두우면 분석하지 않고 다시 찍도록 안내해요. 이때는 이용 횟수가 줄지 않아요.</li>
            <li>개인정보는 가려서 보여 드리고, 사진은 권한이 있는 사람에게만 잠깐 열려요.</li>
          </ul>
        </aside>
      </section>
    </template>
  </div>
</template>

<style scoped>
.hero {
  background: var(--surface-dark);
  color: var(--on-dark);
}
.hero-inner {
  padding-top: var(--s-section);
  padding-bottom: var(--s-section);
  display: flex;
  flex-direction: column;
  gap: var(--s-lg);
}
.hero-title {
  color: var(--on-dark);
}
.hero-text {
  font: var(--t-body-md);
  color: var(--on-dark-soft);
  max-width: 640px;
}
.section {
  padding-top: var(--s-section);
}
.steps {
  margin-top: var(--s-lg);
}
.step {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  padding: var(--s-lg);
  border-top: 2px solid var(--ink);
  background: var(--canvas);
}
.num {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: var(--primary);
  color: var(--on-primary);
  font: var(--t-title-md);
  margin-bottom: var(--s-xs);
}
.cards {
  margin-top: var(--s-md);
}
.card {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  height: 100%;
  min-height: 160px;
  padding: var(--s-lg);
  background: var(--surface-card);
  color: var(--body);
  text-decoration: none;
}
.card:not(.static):hover {
  background: var(--surface-soft);
  text-decoration: none;
}
.card .title-md {
  color: var(--ink);
}
.more {
  margin-top: auto;
  font: var(--t-label);
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--primary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: var(--touch);
}
.todo-grid {
  margin-top: var(--s-md);
}
.todo {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  padding: var(--s-lg);
  border: 1px solid var(--hairline);
  border-top: 4px solid var(--hairline-strong);
  background: var(--canvas);
}
.todo > :last-child {
  margin-top: auto;
  align-self: flex-start;
}
.t-danger {
  border-top-color: var(--error);
}
.t-warn {
  border-top-color: var(--warning);
}
.t-ok {
  border-top-color: var(--success);
}
.t-info {
  border-top-color: var(--primary);
}
.todo-count {
  font: var(--t-display-sm);
  color: var(--ink);
}
.todo-count small {
  font: var(--t-body-sm);
  margin-left: 2px;
  color: var(--muted);
}
.trust {
  background: var(--surface-soft);
  border-left: 4px solid var(--ink);
  padding: var(--s-lg);
}
.trust ul {
  margin-top: var(--s-xs);
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
  list-style: disc;
  padding-left: var(--s-lg);
}
</style>
