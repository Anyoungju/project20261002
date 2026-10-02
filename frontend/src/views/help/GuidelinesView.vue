<script setup lang="ts">
/** 이용 가이드라인 — 촬영·결과 해석·위험 행동·기록·검증 기준·개인정보·결제 원칙 */
import { nextTick, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { GUIDELINES } from '@/content/guidelines';
import HelpShell from '@/components/help/HelpShell.vue';
import BaseButton from '@/components/base/BaseButton.vue';

const route = useRoute();
function printPage() {
  window.print();
}
const toc = GUIDELINES.map((g) => ({ id: g.id, title: g.title }));
onMounted(async () => {
  if (route.hash) {
    await nextTick();
    document.getElementById(route.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }
});
</script>

<template>
  <HelpShell
    eyebrow="도움말"
    title="이용 가이드라인"
    lead="모든 사용자가 같은 기준으로 쓰면 결과가 더 정확해지고 서로 안전해요. 사진·기록·검증·공유의 기준을 정리했어요."
    :toc="toc"
  >
    <template #head-actions>
      <BaseButton variant="secondary" class="no-print" @click="printPage">인쇄하기</BaseButton>
    </template>

    <section v-for="g in GUIDELINES" :id="g.id" :key="g.id" class="sec" :aria-labelledby="`h-${g.id}`">
      <h2 :id="`h-${g.id}`" class="display-sm" tabindex="-1">{{ g.title }}</h2>
      <p class="body-md">{{ g.lead }}</p>

      <div v-if="g.dos || g.donts" class="dd">
        <div v-if="g.dos" class="do">
          <p class="title-sm"><span aria-hidden="true">●</span> 이렇게 해 주세요</p>
          <ul>
            <li v-for="(d, i) in g.dos" :key="i">{{ d }}</li>
          </ul>
        </div>
        <div v-if="g.donts" class="dont">
          <p class="title-sm"><span aria-hidden="true">■</span> 이건 피해 주세요</p>
          <ul>
            <li v-for="(d, i) in g.donts" :key="i">{{ d }}</li>
          </ul>
        </div>
      </div>

      <div v-if="g.table" class="table-wrap" tabindex="0" role="region" :aria-label="`${g.title} 표 (가로로 스크롤)`">
        <table class="table">
          <thead>
            <tr>
              <th v-for="h in g.table.head" :key="h" scope="col">{{ h }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in g.table.rows" :key="i">
              <td v-for="(c, j) in r" :key="j">
                <b v-if="j === 0">{{ c }}</b
                ><template v-else>{{ c }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <dl v-if="g.rules" class="rules">
        <template v-for="r in g.rules" :key="r.term">
          <dt>{{ r.term }}</dt>
          <dd>{{ r.desc }}</dd>
        </template>
      </dl>

      <p v-if="g.note" class="note">{{ g.note }}</p>
    </section>

    <section class="sec">
      <p class="body-sm muted">
        화면별 사용 순서는 <RouterLink to="/manual">사용자 매뉴얼</RouterLink>에서 볼 수 있어요. 이 가이드라인의 기준값(무료 체험 횟수, 반복
        하자 최소 이력 수 등)은 운영자가 정하며, 정해지지 않은 동안에는 보수적으로 동작해요.
      </p>
    </section>
  </HelpShell>
</template>

<style scoped>
.sec {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  scroll-margin-top: 88px;
  padding-top: var(--s-lg);
  border-top: 1px solid var(--hairline);
}
.sec h2:focus {
  outline: none;
}
.dd {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-md);
}
.do,
.dont {
  padding: var(--s-md) var(--s-lg);
  border-left: 4px solid;
}
.do {
  border-color: var(--success);
  background: var(--success-tint);
}
.dont {
  border-color: var(--error);
  background: var(--error-tint);
}
.do .title-sm span {
  color: var(--success-text);
}
.dont .title-sm span {
  color: var(--error-text);
}
.dd ul {
  margin-top: var(--s-xs);
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
  list-style: disc;
  padding-left: var(--s-lg);
  font: var(--t-body-sm);
}
.rules {
  display: grid;
  grid-template-columns: 140px 1fr;
  border-top: 1px solid var(--hairline-strong);
}
.rules dt,
.rules dd {
  padding: var(--s-sm) 0;
  border-bottom: 1px solid var(--hairline);
}
.rules dt {
  font: var(--t-title-sm);
  color: var(--ink);
  padding-right: var(--s-md);
}
.rules dd {
  font: var(--t-body-sm);
  color: var(--body);
}
.note {
  background: var(--surface-soft);
  border-left: 4px solid var(--ink);
  padding: var(--s-sm) var(--s-md);
  font: var(--t-body-sm);
}
@media (max-width: 767px) {
  .dd {
    grid-template-columns: minmax(0, 1fr);
  }
  .do,
  .dont {
    padding: var(--s-md);
  }
  .rules {
    grid-template-columns: minmax(0, 1fr);
  }
  .rules dt {
    border-bottom: 0;
    padding-bottom: 0;
  }
}
</style>
