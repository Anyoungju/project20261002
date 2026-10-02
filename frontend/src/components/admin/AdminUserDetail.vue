<script setup lang="ts">
/**
 * 계정 상세(인라인 펼침) — 역할 · 계정 상태 · 비밀번호 초기화 · 건물 권한.
 * 각 동작은 서버 권한 코드로만 보인다. 확인은 인라인. 실패는 ActionError.
 */
import { computed, onMounted, ref } from 'vue';
import { api, del, get, patch, post, put } from '@/api/client';
import { useSession } from '@/stores/session';
import { fmtDate } from '@/composables/useCan';
import BaseButton from '@/components/base/BaseButton.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import ActionError from './ActionError.vue';
import InlineConfirm from './InlineConfirm.vue';
import TempPassword from './TempPassword.vue';
import { ACCESS_LABEL, BUSINESS_ROLES, roleLabel } from './adminLabels';

interface Building {
  buildingId: number;
  buildingName: string;
  orgId: number | null;
}
const props = defineProps<{ userId: number; buildings: Building[] }>();
const emit = defineEmits<{ changed: [any] }>();
const session = useSession();

const canUsers = computed(() => session.can('admin.users.manage'));
const canAccess = computed(() => session.can('building_access.grant'));
const meIsOperator = computed(() => !!session.me?.roles.includes('operator'));
const isSelf = computed(() => session.me?.userId === props.userId);

const u = ref<any | null>(null);
const loadErr = ref<unknown>(null);
const loading = ref(false);

const roleSel = ref<string[]>([]);
const rolesBusy = ref(false);
const rolesErr = ref<unknown>(null);
const rolesSaved = ref(false);

const stateBusy = ref(false);
const stateErr = ref<unknown>(null);

const pwBusy = ref(false);
const pwErr = ref<unknown>(null);
const tempPw = ref<string | null>(null);

const grantBuilding = ref<number | ''>('');
const grantKind = ref<'record' | 'manage'>('record');
const accessBusy = ref<string | null>(null);
const accessErr = ref<unknown>(null);
const lastAccessOp = ref<(() => Promise<void>) | null>(null);

const roleOptions = computed(() => {
  const list: string[] = [...BUSINESS_ROLES];
  // 운영자 역할은 운영자만 부여·회수한다(서버도 같은 규칙)
  if (meIsOperator.value || u.value?.roles.includes('operator')) list.push('operator');
  return list;
});
const operatorLocked = computed(() => !meIsOperator.value);
const rolesDirty = computed(() => {
  const a = [...roleSel.value].sort().join(',');
  const b = [...(u.value?.roles ?? [])].sort().join(',');
  return a !== b;
});

async function load() {
  loading.value = true;
  loadErr.value = null;
  try {
    u.value = await get(`/api/admin/users/${props.userId}`);
    roleSel.value = [...u.value.roles];
  } catch (e) {
    loadErr.value = e;
  } finally {
    loading.value = false;
  }
}

function applyUser(next: any) {
  u.value = { ...u.value, ...next };
  emit('changed', next);
}

async function saveRoles() {
  if (rolesBusy.value) return;
  rolesBusy.value = true;
  rolesErr.value = null;
  rolesSaved.value = false;
  try {
    const r = await put(`/api/admin/users/${props.userId}/roles`, { roles: roleSel.value });
    applyUser(r);
    roleSel.value = [...r.roles];
    rolesSaved.value = true;
  } catch (e) {
    rolesErr.value = e;
  } finally {
    rolesBusy.value = false;
  }
}

async function setDisabled(disabled: boolean) {
  stateBusy.value = true;
  stateErr.value = null;
  try {
    applyUser(await patch(`/api/admin/users/${props.userId}`, { disabled }));
  } catch (e) {
    stateErr.value = e;
  } finally {
    stateBusy.value = false;
  }
}

async function resetPw() {
  pwBusy.value = true;
  pwErr.value = null;
  try {
    const r = await post<{ temporaryPassword: string }>(`/api/admin/users/${props.userId}/reset-password`);
    tempPw.value = r.temporaryPassword;
    applyUser({ mustChangePassword: true });
  } catch (e) {
    pwErr.value = e;
  } finally {
    pwBusy.value = false;
  }
}

async function runAccess(key: string, op: () => Promise<any>) {
  accessBusy.value = key;
  accessErr.value = null;
  const exec = async () => {
    try {
      const d = await op();
      u.value = { ...u.value, ...d };
      if (key === 'grant') grantBuilding.value = '';
    } catch (e) {
      accessErr.value = e;
    } finally {
      accessBusy.value = null;
    }
  };
  lastAccessOp.value = async () => {
    accessBusy.value = key;
    await exec();
  };
  await exec();
}
function grant() {
  if (!grantBuilding.value) return;
  const body = { buildingId: Number(grantBuilding.value), accessKind: grantKind.value };
  runAccess('grant', () => api(`/api/admin/users/${props.userId}/building-access`, { method: 'POST', body }));
}
function revoke(a: { buildingId: number; accessKind: string }) {
  runAccess(`rv-${a.buildingId}-${a.accessKind}`, () =>
    del(`/api/admin/users/${props.userId}/building-access`, { buildingId: a.buildingId, accessKind: a.accessKind }),
  );
}

const alreadyGranted = computed(
  () =>
    !!grantBuilding.value &&
    !!u.value?.buildingAccess?.some((a: any) => a.buildingId === Number(grantBuilding.value) && a.accessKind === grantKind.value),
);

onMounted(load);
</script>

<template>
  <div class="detail">
    <ActionError v-if="loadErr" :error="loadErr" :busy="loading" @retry="load" />
    <div v-else-if="!u" class="skeleton" style="height: 120px"></div>
    <template v-else>
      <!-- 역할 -->
      <section v-if="canUsers" class="blk" :aria-labelledby="`ud-roles-${userId}`">
        <h3 :id="`ud-roles-${userId}`" class="title-sm">역할</h3>
        <div class="choice-group">
          <label v-for="r in roleOptions" :key="r" class="choice">
            <input v-model="roleSel" type="checkbox" :value="r" :disabled="r === 'operator' && operatorLocked" />
            <span class="box" aria-hidden="true"></span>
            {{ roleLabel(r) }}
          </label>
        </div>
        <p class="caption">
          역할을 바꾸면 그 사용자의 기존 로그인은 끝나고 다시 로그인해야 합니다.<template v-if="operatorLocked">
            운영자 역할은 운영자만 바꿀 수 있습니다.</template
          >
        </p>
        <ActionError
          v-if="rolesErr"
          :error="rolesErr"
          :busy="rolesBusy"
          keeps-input
          title="역할을 저장하지 못했습니다"
          @retry="saveRoles"
        />
        <div class="row">
          <BaseButton size="sm" :busy="rolesBusy" :disabled="!rolesDirty || !roleSel.length" @click="saveRoles">역할 저장</BaseButton>
          <span v-if="!roleSel.length" class="caption">역할을 하나 이상 선택해 주세요</span>
          <StatusBadge v-else-if="rolesSaved && !rolesDirty" tone="ok" label="저장됨" />
        </div>
      </section>

      <!-- 계정 상태 · 비밀번호 -->
      <section v-if="canUsers" class="blk" :aria-labelledby="`ud-state-${userId}`">
        <h3 :id="`ud-state-${userId}`" class="title-sm">계정 상태</h3>
        <div class="row">
          <StatusBadge :tone="u.disabled ? 'danger' : 'ok'" :label="u.disabled ? '비활성' : '활성'" />
          <StatusBadge v-if="u.mustChangePassword" tone="warn" label="비밀번호 변경 대기" />
        </div>
        <ActionError v-if="stateErr" :error="stateErr" :busy="stateBusy" @retry="setDisabled(!u.disabled)" />
        <div class="row">
          <template v-if="!isSelf">
            <InlineConfirm
              v-if="!u.disabled"
              label="비활성화"
              question="이 계정을 비활성화할까요? 즉시 로그아웃되고 로그인할 수 없습니다."
              confirm-label="비활성화"
              :busy="stateBusy"
              @confirm="setDisabled(true)"
            />
            <BaseButton v-else variant="secondary" size="sm" :busy="stateBusy" @click="setDisabled(false)">다시 활성화</BaseButton>
          </template>
          <span v-else class="caption">자기 계정은 비활성화할 수 없습니다</span>
          <InlineConfirm
            v-if="!tempPw"
            label="비밀번호 초기화"
            question="임시 비밀번호를 새로 만들까요? 기존 비밀번호와 로그인은 바로 끝납니다."
            confirm-label="초기화"
            :busy="pwBusy"
            @confirm="resetPw"
          />
        </div>
        <ActionError v-if="pwErr" :error="pwErr" :busy="pwBusy" @retry="resetPw" />
        <TempPassword v-if="tempPw" :password="tempPw" title="비밀번호를 초기화했습니다" @done="tempPw = null" />
      </section>

      <!-- 건물 권한 -->
      <section v-if="canAccess" class="blk" :aria-labelledby="`ud-acc-${userId}`">
        <h3 :id="`ud-acc-${userId}`" class="title-sm">건물 권한</h3>
        <p v-if="!u.buildingAccess?.length" class="body-sm muted">부여된 건물 권한이 없습니다</p>
        <ul v-else class="acc">
          <li v-for="a in u.buildingAccess" :key="`${a.buildingId}-${a.accessKind}`">
            <span class="acc-name">
              <b class="body-sm">{{ a.buildingName }}</b>
              <span class="caption">{{ ACCESS_LABEL[a.accessKind] ?? a.accessKind }} · {{ fmtDate(a.grantedAt) }}</span>
            </span>
            <InlineConfirm
              label="회수"
              :question="`${a.buildingName} ${ACCESS_LABEL[a.accessKind] ?? a.accessKind} 권한을 회수할까요?`"
              confirm-label="회수"
              :busy="accessBusy === `rv-${a.buildingId}-${a.accessKind}`"
              @confirm="revoke(a)"
            />
          </li>
        </ul>
        <form class="grant" @submit.prevent="grant">
          <div class="field">
            <label :for="`ud-b-${userId}`">건물</label>
            <select :id="`ud-b-${userId}`" v-model="grantBuilding" class="select">
              <option value="">건물 선택</option>
              <option v-for="b in buildings" :key="b.buildingId" :value="b.buildingId">{{ b.buildingName }}</option>
            </select>
          </div>
          <fieldset class="field kind">
            <legend class="field-label">권한 종류</legend>
            <div class="choice-group">
              <label class="choice"><input v-model="grantKind" type="radio" :name="`ud-k-${userId}`" value="record" />현장 기록</label>
              <label class="choice"><input v-model="grantKind" type="radio" :name="`ud-k-${userId}`" value="manage" />건물 관리</label>
            </div>
          </fieldset>
          <BaseButton type="submit" size="sm" :busy="accessBusy === 'grant'" :disabled="!grantBuilding || alreadyGranted"
            >권한 부여</BaseButton
          >
        </form>
        <p v-if="alreadyGranted" class="caption">이미 같은 권한이 있습니다</p>
        <p v-if="!buildings.length" class="caption">권한을 줄 수 있는 건물이 없습니다</p>
        <ActionError v-if="accessErr" :error="accessErr" :busy="!!accessBusy" @retry="lastAccessOp?.()" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  padding: var(--s-md);
  background: var(--surface-card);
  border-top: 1px solid var(--hairline);
}
.blk {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
  padding-bottom: var(--s-md);
  border-bottom: 1px solid var(--hairline);
}
.blk:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.acc {
  display: flex;
  flex-direction: column;
}
.acc li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-xs);
  padding: var(--s-xs) 0;
  border-bottom: 1px solid var(--hairline);
}
.acc-name {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.grant {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--s-sm);
  margin-top: var(--s-xs);
}
.grant .field {
  min-width: 200px;
  flex: 1 1 200px;
}
.kind {
  border: 0;
  padding: 0;
  margin: 0;
  flex: 0 1 auto;
  min-width: 0;
}
.kind legend {
  padding: 0;
  margin-bottom: var(--s-xs);
}
</style>
