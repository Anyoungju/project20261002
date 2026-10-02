<script setup lang="ts">
/**
 * 관리 · 계정·권한 — 목록(역할·상태·검색) · 계정 만들기(임시 비밀번호 1회 인라인) · 상세 인라인 펼침.
 * 개인정보는 서버가 준 마스킹 필드만 보인다. 계정 만들기에서 운영자가 입력한 이메일만 예외.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { get, post } from '@/api/client';
import { useSession } from '@/stores/session';
import { fmtDate } from '@/composables/useCan';
import BaseButton from '@/components/base/BaseButton.vue';
import FilterChips from '@/components/base/FilterChips.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import ActionError from '@/components/admin/ActionError.vue';
import TempPassword from '@/components/admin/TempPassword.vue';
import AdminUserDetail from '@/components/admin/AdminUserDetail.vue';
import { BUSINESS_ROLES, ROLE_LABEL, roleLabel } from '@/components/admin/adminLabels';

const session = useSession();
const canUsers = computed(() => session.can('admin.users.manage'));
const meIsOperator = computed(() => !!session.me?.roles.includes('operator'));

const users = ref<any[]>([]);
const loading = ref(false);
const loadErr = ref<unknown>(null);
const scope = ref<{ orgs: any[]; buildings: any[] }>({ orgs: [], buildings: [] });
const filter = reactive({ role: '', status: '', q: '' });
const open = ref<number | null>(null);

const STATUS_OPTS = [
  { value: '', label: '전체' },
  { value: 'active', label: '활성' },
  { value: 'disabled', label: '비활성' },
];
const ROLE_OPTS = computed(() => [...BUSINESS_ROLES, 'operator'].map((r) => ({ value: r, label: ROLE_LABEL[r] })));

async function load() {
  loading.value = true;
  loadErr.value = null;
  try {
    users.value = await get('/api/admin/users', { role: filter.role, status: filter.status, q: filter.q.trim() });
  } catch (e) {
    loadErr.value = e;
  } finally {
    loading.value = false;
  }
}
async function loadScope() {
  try {
    scope.value = await get('/api/admin/scope');
  } catch {
    scope.value = { orgs: [], buildings: [] };
  }
}
function setStatus(v: string) {
  filter.status = v;
  load();
}
function onChanged(id: number, next: any) {
  const i = users.value.findIndex((x) => x.userId === id);
  if (i >= 0) users.value[i] = { ...users.value[i], ...next };
}
function toggle(id: number) {
  open.value = open.value === id ? null : id;
}

// ------------------------------------------------------------ 계정 만들기
const showCreate = ref(false);
const form = reactive({ email: '', displayName: '', phone: '', orgId: '' as number | '', roles: [] as string[] });
const createBusy = ref(false);
const createErr = ref<unknown>(null);
const created = ref<{ user: any; temporaryPassword: string } | null>(null);
const createRoleOpts = computed(() => [...BUSINESS_ROLES, ...(meIsOperator.value ? ['operator'] : [])]);
const createReason = computed(() => {
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return '이메일을 입력해 주세요';
  if (!form.displayName.trim()) return '이름을 입력해 주세요';
  if (!form.roles.length) return '역할을 하나 이상 선택해 주세요';
  return null;
});
async function createUser() {
  if (createBusy.value || createReason.value) return;
  createBusy.value = true;
  createErr.value = null;
  try {
    const r = await post<{ user: any; temporaryPassword: string }>('/api/admin/users', {
      email: form.email.trim(),
      displayName: form.displayName.trim(),
      phone: form.phone.trim() || null,
      orgId: meIsOperator.value ? (form.orgId === '' ? null : Number(form.orgId)) : undefined,
      roles: form.roles,
    });
    created.value = r;
    Object.assign(form, { email: '', displayName: '', phone: '', orgId: '', roles: [] });
    showCreate.value = false;
    await load();
  } catch (e) {
    createErr.value = e;
  } finally {
    createBusy.value = false;
  }
}

onMounted(() => {
  load();
  loadScope();
});
</script>

<template>
  <div class="stack-lg">
    <!-- 계정 만들기 -->
    <section v-if="canUsers" aria-labelledby="au-create">
      <div class="row-between">
        <h2 id="au-create" class="title-lg">계정</h2>
        <BaseButton
          v-if="!showCreate"
          size="sm"
          @click="
            showCreate = true;
            created = null;
          "
          >계정 만들기</BaseButton
        >
      </div>
      <TempPassword
        v-if="created"
        class="gap-top"
        :password="created.temporaryPassword"
        :title="`계정을 만들었습니다 - ${created.user.nameMasked} (${created.user.roles.map(roleLabel).join(', ')})`"
        @done="created = null"
      />
      <form v-if="showCreate" class="create panel" @submit.prevent="createUser">
        <h3 class="title-md">새 계정</h3>
        <div class="grid-2">
          <div class="field">
            <label for="au-email" class="req">이메일</label>
            <input id="au-email" v-model="form.email" class="input" type="email" autocomplete="off" maxlength="120" />
          </div>
          <div class="field">
            <label for="au-name" class="req">이름</label>
            <input id="au-name" v-model="form.displayName" class="input" type="text" autocomplete="off" maxlength="50" />
          </div>
          <div class="field">
            <label for="au-phone">전화번호 <span class="muted">(선택)</span></label>
            <input id="au-phone" v-model="form.phone" class="input" type="tel" inputmode="tel" autocomplete="off" maxlength="20" />
          </div>
          <div v-if="meIsOperator" class="field">
            <label for="au-org">소속 조직</label>
            <select id="au-org" v-model="form.orgId" class="select">
              <option value="">소속 없음</option>
              <option v-for="o in scope.orgs" :key="o.orgId" :value="o.orgId">{{ o.orgName }}</option>
            </select>
          </div>
          <p v-else class="body-sm muted">내 조직 소속으로 만들어집니다.</p>
        </div>
        <fieldset class="roles">
          <legend class="field-label req">역할</legend>
          <div class="choice-group">
            <label v-for="r in createRoleOpts" :key="r" class="choice">
              <input v-model="form.roles" type="checkbox" :value="r" />
              <span class="box" aria-hidden="true"></span>
              {{ roleLabel(r) }}
            </label>
          </div>
        </fieldset>
        <p class="caption">만들면 임시 비밀번호가 한 번만 보입니다. 사용자는 첫 로그인 때 비밀번호를 바꿉니다.</p>
        <ActionError
          v-if="createErr"
          :error="createErr"
          :busy="createBusy"
          keeps-input
          title="계정을 만들지 못했습니다"
          @retry="createUser"
        />
        <div class="row">
          <BaseButton type="submit" :busy="createBusy" :disabled="!!createReason">계정 만들기</BaseButton>
          <BaseButton variant="secondary" @click="showCreate = false">취소</BaseButton>
          <span v-if="createReason" class="caption">{{ createReason }}</span>
        </div>
      </form>
    </section>

    <!-- 필터 -->
    <section class="filters" aria-label="계정 찾기">
      <FilterChips :options="STATUS_OPTS" :model-value="filter.status" label="계정 상태" @update:model-value="setStatus" />
      <form class="search" role="search" @submit.prevent="load">
        <div class="field">
          <label for="au-role">역할</label>
          <select id="au-role" v-model="filter.role" class="select" @change="load">
            <option value="">모든 역할</option>
            <option v-for="o in ROLE_OPTS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="field grow">
          <label for="au-q">이름·이메일 검색</label>
          <input id="au-q" v-model="filter.q" class="input" type="search" maxlength="50" />
        </div>
        <BaseButton type="submit" variant="secondary" :busy="loading">검색</BaseButton>
      </form>
    </section>

    <!-- 목록 -->
    <section aria-labelledby="au-list" aria-live="polite">
      <h2 id="au-list" class="sr-only">계정 목록</h2>
      <ActionError v-if="loadErr" :error="loadErr" :busy="loading" @retry="load" />
      <div v-else-if="loading && !users.length" class="skeleton" style="height: 200px"></div>
      <p v-else-if="!users.length" class="empty">조건에 맞는 계정이 없습니다</p>
      <template v-else>
        <p class="caption count">{{ users.length }}명</p>
        <ul class="users">
          <li v-for="x in users" :key="x.userId" class="user" :class="{ open: open === x.userId }">
            <div class="user-row">
              <div class="who">
                <span class="row">
                  <b class="title-sm">{{ x.nameMasked }}</b>
                  <span class="caption">{{ x.emailMasked }}</span>
                </span>
                <span class="caption"
                  >{{ x.orgName ?? '소속 없음' }}<template v-if="x.phoneMasked"> · {{ x.phoneMasked }}</template> · 가입
                  {{ fmtDate(x.createdAt) }}</span
                >
                <span class="row badges">
                  <StatusBadge :tone="x.disabled ? 'danger' : 'ok'" :label="x.disabled ? '비활성' : '활성'" />
                  <StatusBadge v-if="x.mustChangePassword" tone="warn" label="비밀번호 변경 대기" />
                  <span v-for="r in x.roles" :key="r" class="role">{{ roleLabel(r) }}</span>
                </span>
              </div>
              <BaseButton
                variant="secondary"
                size="sm"
                :aria-expanded="open === x.userId"
                :aria-controls="`au-d-${x.userId}`"
                @click="toggle(x.userId)"
              >
                {{ open === x.userId ? '닫기' : '관리' }}
              </BaseButton>
            </div>
            <AdminUserDetail
              v-if="open === x.userId"
              :id="`au-d-${x.userId}`"
              :user-id="x.userId"
              :buildings="scope.buildings"
              @changed="(n: any) => onChanged(x.userId, n)"
            />
          </li>
        </ul>
      </template>
    </section>
  </div>
</template>

<style scoped>
.gap-top {
  margin-top: var(--s-sm);
}
.create {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  margin-top: var(--s-sm);
}
.roles {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.roles legend {
  padding: 0;
  margin-bottom: var(--s-xs);
}
.filters {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.search {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--s-sm);
}
.search .field {
  min-width: 180px;
}
.search .grow {
  flex: 1 1 240px;
}
.count {
  margin-bottom: var(--s-xs);
}
.users {
  border-top: 1px solid var(--ink);
}
.user {
  border-bottom: 1px solid var(--hairline);
}
.user.open {
  border-bottom-color: var(--hairline-strong);
}
.user-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-sm);
  padding: var(--s-sm) 0;
}
.who {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.badges {
  gap: var(--s-xs);
}
.role {
  font: var(--t-caption);
  color: var(--ink);
  padding: 3px 8px;
  background: var(--surface-soft);
  border: 1px solid var(--hairline);
}
</style>
