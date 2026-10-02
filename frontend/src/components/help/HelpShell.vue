<script setup lang="ts">
/** 매뉴얼·가이드라인 공통 틀 — 상단 탭 · 목차(데스크톱 고정 사이드, 모바일 가로 칩) · 본문 */
import { RouterLink, useRoute } from 'vue-router';

defineProps<{ eyebrow: string; title: string; lead: string; toc: Array<{ id: string; title: string }> }>();
const route = useRoute();

function go(id: string) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    (el.querySelector('h2') as HTMLElement | null)?.focus({ preventScroll: true });
  }
}
</script>

<template>
  <div class="container page">
    <nav class="doc-tabs" aria-label="도움말 종류">
      <RouterLink to="/manual" class="doc-tab" :aria-current="route.path === '/manual' ? 'page' : undefined">사용자 매뉴얼</RouterLink>
      <RouterLink to="/guidelines" class="doc-tab" :aria-current="route.path === '/guidelines' ? 'page' : undefined"
        >이용 가이드라인</RouterLink
      >
    </nav>

    <header class="page-head">
      <div>
        <p class="eyebrow">{{ eyebrow }}</p>
        <h1 class="display-md">{{ title }}</h1>
        <p class="body-md muted lead">{{ lead }}</p>
      </div>
      <slot name="head-actions" />
    </header>

    <slot name="filters" />

    <div class="doc">
      <nav class="toc" aria-label="목차">
        <p class="toc-title">목차</p>
        <ol>
          <li v-for="t in toc" :key="t.id">
            <a :href="`#${t.id}`" @click.prevent="go(t.id)">{{ t.title }}</a>
          </li>
        </ol>
      </nav>
      <div class="doc-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.doc-tabs {
  display: flex;
  gap: var(--s-lg);
  border-bottom: 1px solid var(--hairline);
  margin-bottom: var(--s-lg);
}
.doc-tab {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--muted);
  font: var(--t-nav);
  text-decoration: none;
}
.doc-tab[aria-current='page'] {
  color: var(--ink);
  font-weight: 700;
  border-bottom-color: var(--ink);
}
.lead {
  margin-top: var(--s-xs);
  max-width: 760px;
}
.doc {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: var(--s-xl);
  align-items: start;
}
.toc {
  position: sticky;
  top: 88px;
  border-top: 2px solid var(--ink);
  padding-top: var(--s-sm);
}
.toc-title {
  font: var(--t-label);
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: var(--s-xs);
}
.toc ol {
  display: flex;
  flex-direction: column;
}
.toc a {
  display: flex;
  align-items: center;
  min-height: 40px;
  font: var(--t-body-sm);
  font-weight: 400;
  color: var(--body);
  border-bottom: 1px solid var(--hairline);
  text-decoration: none;
}
.toc a:hover {
  color: var(--primary);
}
.doc-body {
  display: flex;
  flex-direction: column;
  gap: var(--s-xxl);
  min-width: 0;
}
@media (max-width: 1023px) {
  .doc {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-lg);
  }
  .toc {
    position: static;
    border-top: 0;
    padding-top: 0;
  }
  .toc-title {
    display: none;
  }
  .toc ol {
    flex-direction: row;
    gap: var(--s-xs);
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .toc a {
    flex: none;
    min-height: 40px;
    padding: 0 var(--s-md);
    border: 1px solid var(--hairline-strong);
    white-space: nowrap;
  }
}
</style>
