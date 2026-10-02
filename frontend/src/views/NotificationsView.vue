<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { post, errorMessage } from '@/api/client';
import { fetchNotifications } from '@/stores/session';
import { useUi } from '@/stores/ui';
import RetryBox from '@/components/base/RetryBox.vue';
import { fmtDate } from '@/composables/useCan';

const items = ref<any[]>([]);
const loading = ref(true);
const err = ref('');
const ui = useUi();
const router = useRouter();

async function load() {
  loading.value = true;
  err.value = '';
  try {
    const r = await fetchNotifications();
    items.value = r.items;
    ui.unread = r.unreadCount;
  } catch (e) {
    err.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
async function open(n: any) {
  if (!n.readAt) {
    await post(`/api/me/notifications/${n.notifId}/read`).catch(() => undefined);
    n.readAt = new Date().toISOString();
    ui.unread = Math.max(0, ui.unread - 1);
  }
  if (n.link) router.push(n.link);
}
onMounted(load);
</script>

<template>
  <div class="container page">
    <div class="page-head"><h1 class="display-sm">알림</h1></div>
    <RetryBox v-if="err" :message="err" @retry="load" />
    <p v-else-if="loading" class="skeleton" style="height: 120px"></p>
    <p v-else-if="!items.length" class="empty">알림이 없습니다</p>
    <ul v-else class="list">
      <li v-for="n in items" :key="n.notifId">
        <button type="button" class="item" :class="{ unread: !n.readAt }" @click="open(n)">
          <span class="title-sm">{{ n.title }}</span>
          <span class="caption">{{ fmtDate(n.createdAt, true) }}<template v-if="!n.readAt"> · 읽지 않음</template></span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.list {
  border-top: 1px solid var(--hairline);
}
.item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  min-height: 64px;
  padding: var(--s-sm) var(--s-md);
  background: var(--canvas);
  border: 0;
  border-bottom: 1px solid var(--hairline);
  text-align: left;
  cursor: pointer;
}
.item.unread {
  border-left: 4px solid var(--primary);
}
.item:not(.unread) .title-sm {
  font-weight: 400;
  color: var(--body);
}
</style>
