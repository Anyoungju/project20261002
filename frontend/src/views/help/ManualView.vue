<script setup lang="ts">
/** 사용자 매뉴얼 — 역할별로 거를 수 있고, 로그인 사용자는 자기 역할이 기본 선택된다 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useSession } from '@/stores/session';
import { useGates } from '@/stores/gates';
import { MANUAL, ROLE_FILTERS, GATE_HELP, FAQ, type ManualRole } from '@/content/manual';
import HelpShell from '@/components/help/HelpShell.vue';
import FilterChips from '@/components/base/FilterChips.vue';
import BaseButton from '@/components/base/BaseButton.vue';

const session = useSession();
const gates = useGates();
const route = useRoute();

function defaultRole(): string {
  const r = session.me?.roles ?? [];
  if (!session.loggedIn) return 'general';
  for (const k of ['operator', 'enterprise', 'building', 'expert', 'facility']) if (r.includes(k)) return k;
  return 'general';
}
const role = ref<string>('all');

const sections = computed(() =>
  MANUAL.filter((s) => {
    if (role.value === 'all' || !s.roles.length) return true;
    const want = role.value === 'general' ? ['general', 'guest'] : [role.value];
    return s.roles.some((r) => want.includes(r as ManualRole));
  }),
);
const toc = computed(() => [
  ...sections.value.map((s) => ({ id: s.id, title: s.title })),
  { id: 'gates', title: '막혔을 때(차단 안내)' },
  { id: 'faq', title: '자주 묻는 질문' },
]);
const gateRows = computed(() =>
  Object.entries(GATE_HELP).map(([code, h]) => ({ code, message: gates.messageOf(code), party: gates.releasePartyOf(code), ...h })),
);

onMounted(async () => {
  role.value = route.hash ? 'all' : defaultRole();
  await gates.load().catch(() => undefined);
  if (route.hash) {
    await nextTick();
    document.getElementById(route.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }
});
</script>

<template>
  <HelpShell
    eyebrow="도움말"
    title="사용자 매뉴얼"
    lead="화면별로 무엇을, 어떤 순서로 하면 되는지 정리했어요. 역할을 고르면 필요한 내용만 보여요."
    :toc="toc"
  >
    <template #filters>
      <div class="filters">
        <span class="field-label">역할</span>
        <FilterChips v-model="role" :options="ROLE_FILTERS" label="역할별 보기" />
      </div>
    </template>

    <section v-for="s in sections" :id="s.id" :key="s.id" class="sec" :aria-labelledby="`h-${s.id}`">
      <div class="sec-head">
        <h2 :id="`h-${s.id}`" class="display-sm" tabindex="-1">{{ s.title }}</h2>
        <BaseButton v-if="s.screen" variant="text" :to="s.screen.to">{{ s.screen.label }}</BaseButton>
      </div>
      <p class="body-md sec-lead">{{ s.summary }}</p>

      <ol v-if="s.steps" class="steps">
        <li v-for="(st, i) in s.steps" :key="i">
          <span class="n" aria-hidden="true">{{ i + 1 }}</span>
          <div>
            <p class="body-md">{{ st.text }}</p>
            <p v-if="st.note" class="caption">{{ st.note }}</p>
          </div>
        </li>
      </ol>

      <div v-if="s.points" class="points">
        <p class="title-sm">알아 두세요</p>
        <ul>
          <li v-for="(p, i) in s.points" :key="i">{{ p }}</li>
        </ul>
      </div>

      <div v-if="s.trouble" class="trouble">
        <p class="title-sm">이럴 땐 이렇게</p>
        <details v-for="(t, i) in s.trouble" :key="i">
          <summary>{{ t.q }}</summary>
          <p class="body-sm">{{ t.a }}</p>
        </details>
      </div>
    </section>

    <section id="gates" class="sec" aria-labelledby="h-gates">
      <h2 id="h-gates" class="display-sm" tabindex="-1">막혔을 때(차단 안내)</h2>
      <p class="body-md sec-lead">
        진행이 막히면 화면에 붉은 막대가 있는 안내 상자가 나와요. 첫 줄 문구로 아래 표에서 찾아보세요. 안내 상자는 조건이 풀리면 저절로
        사라져요.
      </p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="차단 안내 표 (가로로 스크롤)">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">화면에 나오는 문구</th>
              <th scope="col">언제</th>
              <th scope="col">해결 방법</th>
              <th scope="col">해결하는 사람</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in gateRows" :key="g.code">
              <td>
                <b>{{ g.message || '불러오는 중' }}</b> <span class="caption">{{ g.code }}</span>
              </td>
              <td>{{ g.when }}</td>
              <td>{{ g.how }}</td>
              <td>{{ g.party }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="faq" class="sec" aria-labelledby="h-faq">
      <h2 id="h-faq" class="display-sm" tabindex="-1">자주 묻는 질문</h2>
      <div class="trouble">
        <details v-for="(f, i) in FAQ" :key="i">
          <summary>{{ f.q }}</summary>
          <p class="body-sm">{{ f.a }}</p>
        </details>
      </div>
      <p class="body-sm muted">찾는 내용이 없으면 <RouterLink to="/guidelines">이용 가이드라인</RouterLink>도 확인해 보세요.</p>
    </section>
  </HelpShell>
</template>

<style scoped>
.filters {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  margin-bottom: var(--s-lg);
}
.sec {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  scroll-margin-top: 88px;
  padding-top: var(--s-lg);
  border-top: 1px solid var(--hairline);
}
.sec-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-sm);
}
.sec-head h2:focus {
  outline: none;
}
.sec-lead {
  color: var(--body);
}
.steps {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.steps li {
  display: flex;
  gap: var(--s-sm);
  align-items: flex-start;
}
.n {
  flex: none;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  background: var(--primary);
  color: var(--on-primary);
  font: var(--t-title-sm);
}
.points {
  background: var(--surface-soft);
  padding: var(--s-md) var(--s-lg);
}
.points ul {
  margin-top: var(--s-xs);
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
  list-style: disc;
  padding-left: var(--s-lg);
  font: var(--t-body-sm);
}
.trouble {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
details {
  border: 1px solid var(--hairline);
  background: var(--canvas);
}
summary {
  min-height: var(--touch);
  display: flex;
  align-items: center;
  padding: var(--s-xs) var(--s-md);
  font: var(--t-title-sm);
  color: var(--ink);
  cursor: pointer;
}
details p {
  padding: 0 var(--s-md) var(--s-md);
}
@media (max-width: 767px) {
  .points {
    padding: var(--s-md);
  }
}
</style>
