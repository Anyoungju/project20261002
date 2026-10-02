<script setup lang="ts">
/**
 * 관리 · 역할-권한 매트릭스 (R22). 전체 표는 읽기 전용, 편집은 역할 하나씩(모바일에서도 한 열씩).
 * 편집은 admin.rbac.manage 만. 잠긴 권한은 운영자에게서 뗄 수 없다(서버도 거부).
 */
import { computed, onMounted, ref, watch } from 'vue';
import { get, put } from '@/api/client';
import { useSession } from '@/stores/session';
import BaseButton from '@/components/base/BaseButton.vue';
import FilterChips from '@/components/base/FilterChips.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import ActionError from '@/components/admin/ActionError.vue';
import { roleLabel } from '@/components/admin/adminLabels';

interface Matrix {
  roles: string[];
  permissions: Array<{ code: string; description: string; locked: boolean }>;
  grants: Record<string, string[]>;
}

const session = useSession();
const canEdit = computed(() => session.can('admin.rbac.manage'));

const m = ref<Matrix | null>(null);
const loading = ref(false);
const loadErr = ref<unknown>(null);
const role = ref('general');
const draft = ref<string[]>([]);
const busy = ref(false);
const saveErr = ref<unknown>(null);
const savedRole = ref<string | null>(null);

const roleOpts = computed(() => (m.value?.roles ?? []).map((r) => ({ value: r, label: roleLabel(r) })));
const granted = (r: string, code: string) => !!m.value?.grants[r]?.includes(code);
const isLockedFor = (code: string) => role.value === 'operator' && !!m.value?.permissions.find((p) => p.code === code)?.locked;
const dirty = computed(() => [...draft.value].sort().join(',') !== [...(m.value?.grants[role.value] ?? [])].sort().join(','));

function resetDraft() {
  draft.value = [...(m.value?.grants[role.value] ?? [])];
  saveErr.value = null;
}
watch(role, () => {
  resetDraft();
  savedRole.value = null;
});

async function load() {
  loading.value = true;
  loadErr.value = null;
  try {
    m.value = await get<Matrix>('/api/admin/rbac/matrix');
    if (!m.value.roles.includes(role.value)) role.value = m.value.roles[0];
    resetDraft();
  } catch (e) {
    loadErr.value = e;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (busy.value || !dirty.value) return;
  busy.value = true;
  saveErr.value = null;
  try {
    m.value = await put<Matrix>(`/api/admin/rbac/roles/${role.value}/permissions`, { permissions: draft.value });
    resetDraft();
    savedRole.value = role.value;
    await session.refresh(); // 내 권한이 바뀌었을 수 있다
  } catch (e) {
    saveErr.value = e;
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="stack-lg">
    <div>
      <h2 class="title-lg">역할-권한</h2>
      <p class="body-sm muted">메뉴와 버튼은 이 표의 권한으로만 열립니다. 바꾸면 해당 역할 사용자에게 바로 적용됩니다.</p>
    </div>

    <ActionError v-if="loadErr" :error="loadErr" :busy="loading" @retry="load" />
    <div v-else-if="!m" class="skeleton" style="height: 240px"></div>
    <template v-else>
      <!-- 편집: 역할 하나씩 -->
      <section v-if="canEdit" class="edit panel" aria-labelledby="rb-edit">
        <h3 id="rb-edit" class="title-md">역할별 권한 편집</h3>
        <FilterChips v-model="role" :options="roleOpts" label="편집할 역할" />
        <fieldset class="perms">
          <legend class="sr-only">{{ roleLabel(role) }} 권한</legend>
          <label v-for="p in m.permissions" :key="p.code" class="choice check-row" :class="{ locked: isLockedFor(p.code) }">
            <input v-model="draft" type="checkbox" :value="p.code" :disabled="isLockedFor(p.code)" />
            <span class="box" aria-hidden="true"></span>
            <span class="perm">
              <span class="body-sm desc">{{ p.description }}</span>
              <span class="caption mono">{{ p.code }}</span>
            </span>
            <StatusBadge v-if="p.locked" tone="ref" :label="isLockedFor(p.code) ? '잠김 - 뗄 수 없음' : '잠김'" />
          </label>
        </fieldset>
        <ActionError v-if="saveErr" :error="saveErr" :busy="busy" keeps-input title="권한을 저장하지 못했습니다" @retry="save" />
        <div class="row">
          <BaseButton :busy="busy" :disabled="!dirty" @click="save">{{ roleLabel(role) }} 권한 저장</BaseButton>
          <BaseButton v-if="dirty" variant="secondary" @click="resetDraft">되돌리기</BaseButton>
          <StatusBadge v-if="savedRole === role && !dirty" tone="ok" label="저장됨" />
          <span v-else-if="dirty" class="caption">저장하지 않은 변경이 있습니다</span>
        </div>
      </section>

      <!-- 전체 표(읽기 전용) -->
      <section aria-labelledby="rb-table">
        <h3 id="rb-table" class="title-md">전체 매트릭스</h3>
        <p class="caption">● 부여 · – 없음 · 잠김 권한은 운영자에게서 뗄 수 없습니다</p>
        <div class="table-wrap">
          <table class="table matrix">
            <caption class="sr-only">
              역할(열)별 권한(행) 부여 현황
            </caption>
            <thead>
              <tr>
                <th scope="col" class="pcol">권한</th>
                <th v-for="r in m.roles" :key="r" scope="col" class="rcol">{{ roleLabel(r) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in m.permissions" :key="p.code">
                <th scope="row" class="pcol">
                  <span class="body-sm desc">{{ p.description }}</span>
                  <span class="caption mono">{{ p.code }}<template v-if="p.locked"> · 잠김</template></span>
                </th>
                <td v-for="r in m.roles" :key="r" class="rcol">
                  <span v-if="granted(r, p.code)" class="on" :aria-label="`${roleLabel(r)} 부여`">●</span>
                  <span v-else class="off" :aria-label="`${roleLabel(r)} 없음`">–</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.edit {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
}
.perms {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: var(--s-xs);
}
.perm {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.perm .mono {
  word-break: break-all;
}
.desc {
  color: var(--ink);
  font-weight: 400;
}
.locked {
  background: var(--surface-soft);
  cursor: not-allowed;
}
.matrix th.pcol {
  text-transform: none;
  letter-spacing: 0;
  white-space: normal;
  min-width: 200px;
  position: sticky;
  left: 0;
  background: var(--canvas);
}
.matrix tbody th.pcol {
  display: table-cell;
  font: var(--t-body-sm);
  border-bottom: 1px solid var(--hairline);
}
.matrix tbody th.pcol > span {
  display: block;
}
.matrix .rcol {
  text-align: center;
  white-space: nowrap;
}
.on {
  color: var(--ink);
  font-weight: 700;
}
.off {
  color: var(--muted-soft);
}
</style>
