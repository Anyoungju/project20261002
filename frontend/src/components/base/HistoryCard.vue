<script setup lang="ts">
/** 스타일가이드 Inventory Card → 하자 이력 카드: surface-card 사진 플레이트 + 제목 아래, 그림자 없음 */
defineProps<{ title: string; meta?: string; as?: 'div' | 'li' }>();
</script>

<template>
  <component :is="as ?? 'div'" class="hcard">
    <div v-if="$slots.media" class="media"><slot name="media" /></div>
    <div class="content">
      <div class="badges"><slot name="badges" /></div>
      <p class="title-md t">{{ title }}</p>
      <p v-if="meta" class="caption">{{ meta }}</p>
      <slot />
      <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
    </div>
  </component>
</template>

<style scoped>
.hcard {
  display: flex;
  flex-direction: column;
  background: var(--canvas);
  border: 1px solid var(--hairline);
}
.media {
  background: var(--surface-card);
}
.content {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  padding: var(--s-md);
  flex: 1;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
}
.badges:empty {
  display: none;
}
.t {
  font-size: 17px;
}
.actions {
  margin-top: auto;
  padding-top: var(--s-xs);
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
}
</style>
