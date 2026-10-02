<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import AppHeader from '@/components/layout/AppHeader.vue';
import AppFooter from '@/components/layout/AppFooter.vue';
import ForbiddenView from '@/views/ForbiddenView.vue';
import ScreenGuide from '@/components/layout/ScreenGuide.vue';
import { useUi } from '@/stores/ui';
import { useGates } from '@/stores/gates';
import { useReference } from '@/stores/reference';

const ui = useUi();
onMounted(() => {
  useGates()
    .load()
    .catch(() => undefined);
  useReference()
    .load()
    .catch(() => undefined);
});
</script>

<template>
  <a class="skip" href="#main">본문 바로가기</a>
  <AppHeader />
  <main id="main" tabindex="-1">
    <ScreenGuide v-if="!ui.forbidden" />
    <ForbiddenView v-if="ui.forbidden" :screen="ui.forbidden.screen" :title="ui.forbidden.title" />
    <RouterView v-else v-slot="{ Component, route }">
      <component :is="Component" :key="route.path" />
    </RouterView>
  </main>
  <AppFooter />
</template>

<style>
.skip {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 200;
  background: var(--ink);
  color: var(--on-dark);
  padding: var(--s-sm) var(--s-md);
}
.skip:focus {
  left: var(--s-md);
}
#main {
  min-height: calc(100vh - 64px - 120px);
  outline: none;
}
</style>
