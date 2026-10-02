<script setup lang="ts">
/** 스타일가이드 Buttons — primary(단일 블루) · secondary · text-link(UPPERCASE·1.5px·›) · on-dark. 0px 직각, 높이 48 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'text' | 'on-dark' | 'ghost';
    type?: 'button' | 'submit';
    busy?: boolean;
    disabled?: boolean;
    to?: string | Record<string, any>;
    block?: boolean;
    size?: 'md' | 'sm';
  }>(),
  { variant: 'primary', type: 'button', busy: false, disabled: false, block: false, size: 'md', to: undefined },
);
const emit = defineEmits<{ click: [MouseEvent] }>();
const inert = computed(() => props.disabled || props.busy);
function onClick(e: MouseEvent) {
  if (inert.value) {
    e.preventDefault();
    return;
  }
  emit('click', e);
}
</script>

<template>
  <RouterLink v-if="to && !inert" :to="to" class="btn" :class="[`btn-${variant}`, { 'btn-block': block, 'btn-sm': size === 'sm' }]">
    <slot />
    <span v-if="variant === 'text'" aria-hidden="true" class="chev">›</span>
  </RouterLink>
  <button
    v-else
    :type="type"
    class="btn"
    :class="[`btn-${variant}`, { 'btn-block': block, 'btn-sm': size === 'sm', 'is-disabled': inert }]"
    :aria-disabled="inert ? 'true' : undefined"
    :aria-busy="busy ? 'true' : undefined"
    @click="onClick"
  >
    <template v-if="busy">처리 중</template>
    <slot v-else />
    <span v-if="variant === 'text' && !busy" aria-hidden="true" class="chev">›</span>
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-xs);
  min-height: var(--touch);
  min-width: var(--touch);
  padding: 14px var(--s-xl);
  border: 0;
  border-radius: var(--r-none);
  font: var(--t-button);
  letter-spacing: 0.5px;
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
}
.btn:hover {
  text-decoration: none;
}
.btn-sm {
  padding: 10px var(--s-md);
}
.btn-block {
  width: 100%;
}
.btn-primary {
  background: var(--primary);
  color: var(--on-primary);
}
.btn-primary:active {
  background: var(--primary-active);
}
.btn-secondary {
  background: var(--canvas);
  color: var(--ink);
  border: 1px solid var(--hairline-strong);
}
.btn-secondary:active {
  background: var(--surface-soft);
}
.btn-ghost {
  background: transparent;
  color: var(--ink);
  border: 1px solid transparent;
  padding-left: var(--s-sm);
  padding-right: var(--s-sm);
}
.btn-on-dark {
  background: transparent;
  color: var(--on-dark);
  border: 1px solid var(--on-dark);
}
.btn-text {
  background: transparent;
  color: var(--primary);
  padding: 0 var(--s-xxs);
  font: var(--t-label);
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
.chev {
  font-size: 16px;
  line-height: 1;
}
.is-disabled,
.is-disabled:active {
  background: var(--primary-disabled);
  color: var(--muted);
  border-color: var(--primary-disabled);
  cursor: not-allowed;
}
.btn-text.is-disabled {
  background: transparent;
  color: var(--muted-soft);
}
.btn[aria-busy='true'] {
  cursor: progress;
}
</style>
