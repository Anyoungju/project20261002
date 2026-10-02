<script setup lang="ts">
/**
 * 화면 사용법 — 처음 방문하면 펼쳐 보여 주고, 한 번 접으면 이 기기에서는 접힌 채로 둔다(localStorage).
 * 모달이 아니라 화면 흐름 안의 접이식 안내다.
 */
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

const GUIDES: Record<string, { title: string; steps: string[]; tip?: string }> = {
  S2: {
    title: '사진으로 하자를 확인하는 방법',
    steps: [
      '하자 부위를 밝은 곳에서, 화면 가운데 오도록 찍어 올려요(여러 장 가능).',
      '어떤 상황인지 짧게 적으면 더 정확해요(선택).',
      '[분석 요청]을 누르면 보통 1분 안에 원인과 대응방안이 나와요.',
    ],
    tip: '사진이 흐리거나 어두워 분석하지 못하면 이용 횟수가 줄지 않아요.',
  },
  S1: {
    title: '이용권 고르는 방법',
    steps: [
      '건별 분석은 필요할 때 한 번씩, 월 구독은 한 달 동안 횟수 제한 없이 써요.',
      '요금과 조건을 확인하고 결제해요.',
      '결제가 끝나면 [분석 계속하기]로 하던 분석으로 돌아가요. 입력한 사진과 설명은 그대로 있어요.',
    ],
  },
  S3: {
    title: '현장 기록 남기는 방법',
    steps: [
      '건물을 고르고, AI 분석 결과가 있으면 연결해요(없으면 신규 하자로 시작).',
      '위치·하자 종류·보수 결과(완료/미완료)를 고르고 현장 사진을 1장 이상 올려요.',
      '[기록 저장]을 누르면 하자 종류별로 분류돼요.',
    ],
    tip: 'AI 결과와 현장 판단이 다르면 "불일치"를 고르세요. 전문가가 자동으로 확인해요.',
  },
  S7B: {
    title: '배정된 점검 처리하는 방법',
    steps: [
      '지연된 점검이 맨 위에 있어요.',
      '[현장 기록 시작]으로 점검 내용을 기록하고 저장하면 일정이 완료돼요.',
      '전문가가 추가 사진을 요청하면 여기에 함께 보여요.',
    ],
  },
  S4: {
    title: '검증하는 방법',
    steps: [
      '목록에서 건을 고르면 AI 결과와 현장 기록이 나란히 보여요.',
      '일치·불일치를 고르고 의견을 남겨요(불일치면 차이를 적어 주세요).',
      '자료가 부족하면 [판정 불가]로 시설관리자에게 추가 사진을 요청해요.',
    ],
  },
  S8B: {
    title: '점검 요청 응답하는 방법',
    steps: [
      '동의된 범위의 하자 자료만 보여요.',
      '[수락]하면 연결이 확정되고 서로의 연락처가 공개돼요.',
      '어렵다면 [거절]하고 사유를 남겨 주세요. 수수료는 생기지 않아요.',
    ],
  },
  S5: {
    title: '건물 이력 보는 방법',
    steps: [
      '건물을 고르면 AI 분석·현장 기록·전문가 판정·외부 시스템 이력이 시간순으로 보여요.',
      '기간과 하자 종류로 거를 수 있고, 카드를 누르면 자세히 보여요.',
      '[반복 하자] 탭에서 같은 곳에 되풀이되는 하자를 찾아 정기점검이나 전문가 연결로 이어 가요.',
    ],
    tip: '이 화면에서는 기록을 고치지 않아요(조회 전용).',
  },
  S7A: {
    title: '정기점검 일정 관리 방법',
    steps: [
      '건물을 고르고 점검 항목·주기·기한·담당 시설관리자를 정해요.',
      '저장하면 담당자에게 배정 알림이 가요.',
      '기한이 지나도록 기록이 없으면 "지연"으로 표시되고 담당자에게도 알림이 가요.',
    ],
  },
  S8A: {
    title: '전문가를 연결하는 방법',
    steps: [
      '위험 통지에서 [전문가 점검 요청]을 누르면 하자 건이 자동으로 선택돼요.',
      '전문 분야와 희망 기간을 정하면 가능한 전문가 후보가 보여요.',
      '수수료와 공유될 자료를 확인하고 동의한 뒤 요청을 확정해요. 전문가가 수락하면 연결돼요.',
    ],
    tip: '동의 전에는 어떤 자료도 전문가에게 전달되지 않아요.',
  },
  S6: {
    title: '우선순위 보는 방법',
    steps: [
      '건물 범위와 기간을 고르고 [우선순위 산출]을 눌러요.',
      '재발 횟수·위험도·미조치 기간을 반영한 순서가 나와요. 항목을 펼치면 근거 이력이 보여요.',
      '상위 항목에 정기점검이나 전문가 연결을 지정하면 건물관리자에게 전달돼요.',
    ],
    tip: '산출 결과는 그때의 기록으로 고정돼요. 다시 열어도 바뀌지 않아요.',
  },
  ADMIN: {
    title: '관리 화면 사용법',
    steps: [
      '계정·권한: 사용자를 만들고 역할과 건물 권한을 정해요.',
      '권한 요청: 동료가 보낸 화면 접근 요청을 승인하거나 거절해요.',
      '역할-권한: 역할마다 할 수 있는 일을 확인해요.',
    ],
  },
};

const ANCHOR: Record<string, string> = {
  S2: 'analysis',
  S1: 'purchase',
  S3: 'record',
  S7B: 'assignments',
  S4: 'verify',
  S8B: 'inbox',
  S5: 'history',
  S7A: 'schedule',
  S8A: 'expert-connect',
  S6: 'priority',
  ADMIN: 'admin',
};
const route = useRoute();
const screen = computed(() => route.meta.screen as string | undefined);
const guide = computed(() => (screen.value ? GUIDES[screen.value] : undefined));
const open = ref(false);
const key = () => `bc:guide:${screen.value}`;
watch(
  screen,
  () => {
    try {
      open.value = !!guide.value && localStorage.getItem(key()) !== 'closed';
    } catch {
      open.value = !!guide.value;
    }
  },
  { immediate: true },
);
function toggle() {
  open.value = !open.value;
  try {
    localStorage.setItem(key(), open.value ? 'open' : 'closed');
  } catch {
    /* 저장 불가 환경 */
  }
}
</script>

<template>
  <section v-if="guide" class="guide no-print" :aria-label="guide.title">
    <div class="container">
      <button type="button" class="guide-toggle" :aria-expanded="open" :aria-label="`이 화면 사용법: ${guide.title}`" @click="toggle">
        <span class="q" aria-hidden="true">?</span>
        <span>{{ open ? guide.title : '이 화면 사용법' }}</span>
        <span class="chev" aria-hidden="true">{{ open ? '접기 ▴' : '펼치기 ▾' }}</span>
      </button>
      <div v-if="open" class="guide-body">
        <ol class="steps">
          <li v-for="(s, i) in guide.steps" :key="i">
            <span class="n">{{ i + 1 }}</span
            >{{ s }}
          </li>
        </ol>
        <p v-if="guide.tip" class="tip"><b>알아 두세요</b> {{ guide.tip }}</p>
        <p class="more">
          <RouterLink :to="`/manual#${ANCHOR[screen!] ?? 'start'}`">매뉴얼에서 자세히 보기 ›</RouterLink>
          <RouterLink to="/guidelines">이용 가이드라인 ›</RouterLink>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.guide {
  background: var(--canvas);
  border-bottom: 1px solid var(--hairline);
}
.guide-toggle {
  display: flex;
  align-items: center;
  gap: var(--s-xs);
  width: 100%;
  min-height: var(--touch);
  padding: 0;
  border: 0;
  background: none;
  font: var(--t-body-sm);
  font-weight: 700;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}
.q {
  width: 24px;
  height: 24px;
  border-radius: var(--r-full);
  display: grid;
  place-items: center;
  background: var(--primary);
  color: var(--on-primary);
  font: var(--t-caption);
  font-weight: 700;
  flex: none;
}
.chev {
  margin-left: auto;
  font: var(--t-caption);
  color: var(--muted);
}
.guide-body {
  padding-bottom: var(--s-md);
}
.steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-sm) var(--s-lg);
}
.steps li {
  display: flex;
  gap: var(--s-xs);
  font: var(--t-body-sm);
  color: var(--body);
}
.n {
  flex: none;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  background: var(--ink);
  color: var(--on-dark);
  font: var(--t-caption);
  font-weight: 700;
}
.tip {
  margin-top: var(--s-sm);
  font: var(--t-body-sm);
  color: var(--body);
  background: var(--surface-soft);
  padding: var(--s-xs) var(--s-sm);
}
.more {
  margin-top: var(--s-xs);
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-lg);
}
.more a {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  font: var(--t-label);
}
.tip b {
  margin-right: var(--s-xs);
  color: var(--ink);
}
@media (max-width: 767px) {
  .steps {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
