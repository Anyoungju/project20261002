<script setup lang="ts">
/**
 * S3 현장 점검·보수 기록 (UC3 · P3 · SD_02 §6 · FR-030~037 · FR-120b) — 모바일 우선, 한 손 입력.
 *
 * /records/new?buildingId=&resultId=&scheduleId=
 *   C8 건물 선택 → 건물 이력 요약(rail) → AI 결과 연결(선택 · "연결 없음 - 신규 하자") → [기록 시작] = 초안 생성
 * /records/:recordId(?scheduleId=)
 *   초안: 필수 항목(위치·하자 종류·보수 결과·AI 일치) 맨 위 → 사진 → 선택 항목 → 하단 고정 [기록 저장]
 *         저장 누락은 서버 G5 → C2 블록 + [누락 항목으로 이동] (게이트는 코드에서 재계산하지 않는다)
 *   저장됨: 읽기 전용. 보수 결과 미완료 → 완료 갱신만. 추가 자료 요청이 열려 있으면 사진 추가로 해소.
 * 입력값 보존(FR-102): 텍스트 localStorage `S3:<recordId>`, 사진 IndexedDB 같은 키.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, get, patch, post, ApiError, GateBlockError, newIdempotencyKey, errorMessage, type GateBlock } from '@/api/client';
import { useSession } from '@/stores/session';
import { useReference } from '@/stores/reference';
import { loadDraft, saveDraft, clearDraft, saveDraftPhotos, loadDraftPhotos, clearDraftPhotos } from '@/stores/drafts';
import { RISK_LABEL, riskTone, fmtDate } from '@/composables/useCan';
import C1ProgressRail from '@/components/common/C1ProgressRail.vue';
import C2GateBlock from '@/components/common/C2GateBlock.vue';
import C3ReasonedButton from '@/components/common/C3ReasonedButton.vue';
import C7SourceStatusBar from '@/components/common/C7SourceStatusBar.vue';
import C8BuildingPicker from '@/components/common/C8BuildingPicker.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import PhotoThumb from '@/components/common/PhotoThumb.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import PhotoPicker from '@/components/base/PhotoPicker.vue';
import RetryBox from '@/components/base/RetryBox.vue';
import AlertBox from '@/components/base/AlertBox.vue';
import SpecCell from '@/components/base/SpecCell.vue';
import AiResultBrief from '@/components/record/AiResultBrief.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();
const reference = useReference();

const recordId = computed(() => (route.params.recordId ? Number(route.params.recordId) : null));
const scheduleId = computed(() => (route.query.scheduleId ? Number(route.query.scheduleId) : null));

// ================================================================= 공통: 배정 일정 맥락 (S7B 진입)
const scheduleInfo = ref<{ itemText: string; dueDate: string; buildingId: number; buildingName: string } | null>(null);
async function loadSchedule() {
  if (!scheduleId.value || !session.can('schedule.read.assigned')) return;
  try {
    const r = await get('/api/me/assignments');
    scheduleInfo.value = r.schedules.find((s: any) => s.scheduleId === scheduleId.value) ?? null;
  } catch {
    scheduleInfo.value = null;
  }
}

// ================================================================= 새 기록 (건물 선택 · 결과 연결)
const buildingId = ref<number | null>(route.query.buildingId ? Number(route.query.buildingId) : null);
const rail = ref<any | null>(null);
const railErr = ref('');
const linkables = ref<any[]>([]);
const linkLoading = ref(false);
const linkChoice = ref<string>(route.query.resultId ? String(route.query.resultId) : '');
const createBusy = ref(false);
const createErr = ref('');
const createGate = ref<GateBlock | null>(null);

async function loadBuilding(id: number) {
  rail.value = null;
  railErr.value = '';
  linkLoading.value = true;
  try {
    const [r, l] = await Promise.all([
      get(`/api/buildings/${id}/rail`).catch((e) => ((railErr.value = errorMessage(e)), null)),
      get('/api/records/linkable-results', { buildingId: id }),
    ]);
    rail.value = r;
    linkables.value = l;
    if (linkChoice.value && linkChoice.value !== 'none' && !l.some((x: any) => String(x.resultId) === linkChoice.value))
      linkChoice.value = '';
  } catch (e) {
    linkables.value = [];
    createErr.value = errorMessage(e);
  } finally {
    linkLoading.value = false;
  }
}
watch(buildingId, (id) => {
  createErr.value = '';
  createGate.value = null;
  if (id && !recordId.value) loadBuilding(id);
});

const railCounts = computed(() =>
  rail.value
    ? [
        { label: '이력', value: rail.value.historyCount },
        { label: '지연', value: rail.value.overdueCount, alert: true },
        { label: '연결 대기', value: rail.value.awaitingCount },
      ]
    : [],
);
const sourceItems = computed(() =>
  rail.value?.source?.externalMissing
    ? [
        {
          key: 'ext',
          label: '외부 시스템 이력 미반영',
          detail: rail.value.source.errorMessage ?? '건물 관리 시스템과 마지막 동기화가 정상 완료되지 않았습니다',
        },
      ]
    : [],
);
const createReason = computed(() => {
  if (!buildingId.value) return '건물을 선택해 주세요';
  if (!linkChoice.value) return '연결할 분석 결과를 고르거나 "연결 없음 - 신규 하자"를 선택해 주세요';
  return null;
});

async function createRecord() {
  if (createBusy.value || createReason.value) return;
  createBusy.value = true;
  createErr.value = '';
  createGate.value = null;
  try {
    const r = await post('/api/records', {
      buildingId: buildingId.value,
      resultId: linkChoice.value === 'none' ? null : Number(linkChoice.value),
    });
    await router.replace({ path: `/records/${r.recordId}`, query: scheduleId.value ? { scheduleId: String(scheduleId.value) } : {} });
  } catch (e) {
    if (e instanceof GateBlockError) createGate.value = e.block;
    else createErr.value = errorMessage(e);
  } finally {
    createBusy.value = false;
  }
}

// ================================================================= 기록 (초안 · 저장됨)
interface Form {
  floor: string;
  dir: string;
  detail: string;
  defectTypeCode: string;
  repairStatus: '' | 'completed' | 'pending';
  aiMatch: '' | 'match' | 'mismatch';
  repairMethod: string;
  inspectionNote: string;
  riskFlag: boolean;
}
const EMPTY: Form = {
  floor: '',
  dir: '',
  detail: '',
  defectTypeCode: '',
  repairStatus: '',
  aiMatch: '',
  repairMethod: '',
  inspectionNote: '',
  riskFlag: false,
};
const FLOORS = ['지하', '1층', '2층', '3층', '4층 이상', '옥상'];
const DIRS = ['동측', '서측', '남측', '북측', '실내'];

const dto = ref<any | null>(null);
const loading = ref(false);
const loadErr = ref('');
const form = ref<Form>({ ...EMPTY });
const ready = ref(false);
const draftKey = computed(() => (recordId.value ? `S3:${recordId.value}` : ''));

const isDraft = computed(() => dto.value?.recordStatus === 'draft');
const isRecorder = computed(() => !!dto.value && dto.value.recorderId === session.me?.userId);
const editable = computed(() => isDraft.value && isRecorder.value);
const linked = computed(() => !!dto.value?.resultId);
const locationText = computed(() => [form.value.floor, form.value.dir, form.value.detail.trim()].filter(Boolean).join(' '));

async function loadRecord() {
  if (!recordId.value) return;
  loading.value = true;
  loadErr.value = '';
  try {
    const d = await get(`/api/records/${recordId.value}`);
    dto.value = d;
    if (d.recordStatus === 'draft' && d.recorderId === session.me?.userId && !ready.value) {
      const f = d.fields;
      const fromServer: Form = {
        ...EMPTY,
        detail: f.locationText ?? '',
        defectTypeCode: f.defectTypeCode ?? '',
        repairStatus: f.repairStatus ?? '',
        aiMatch: f.aiMatch === 'match' || f.aiMatch === 'mismatch' ? f.aiMatch : '',
        repairMethod: f.repairMethod ?? '',
        inspectionNote: f.inspectionNote ?? '',
        riskFlag: !!f.riskFlag,
      };
      lastSynced = JSON.stringify(payloadOf(fromServer));
      const local = loadDraft<Form>(draftKey.value);
      form.value = local ? { ...fromServer, ...local } : fromServer;
      if (!local && !fromServer.inspectionNote && scheduleInfo.value)
        form.value.inspectionNote = `정기점검: ${scheduleInfo.value.itemText}`;
      const ph = await loadDraftPhotos(draftKey.value);
      if (ph.length) {
        pending.value = ph;
        uploadErr.value = `이전에 올리지 못한 사진 ${ph.length}장이 이 기기에 남아 있습니다`;
      }
      ready.value = true;
      if (JSON.stringify(payloadOf(form.value)) !== lastSynced) scheduleSync();
    }
  } catch (e) {
    loadErr.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------- 필드 동기화 (PATCH, 디바운스 + blur + 저장 전)
let lastSynced = '';
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncChain: Promise<void> = Promise.resolve();
const syncErr = ref('');
const syncing = ref(false);

function payloadOf(f: Form) {
  const p: Record<string, unknown> = {
    locationText: [f.floor, f.dir, f.detail.trim()].filter(Boolean).join(' ') || null,
    defectTypeCode: f.defectTypeCode || null,
    repairStatus: f.repairStatus || null,
    repairMethod: f.repairMethod.trim() || null,
    inspectionNote: f.inspectionNote.trim() || null,
    riskFlag: f.riskFlag,
  };
  // 연결 결과가 없으면 AI 일치 여부는 "해당 없음"(서버가 저장 시 none 으로 둔다)
  if (dto.value?.resultId) p.aiMatch = f.aiMatch || null;
  return p;
}
function syncNow(): Promise<void> {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  syncChain = syncChain.then(async () => {
    if (!editable.value || !recordId.value) return;
    const body = payloadOf(form.value);
    const s = JSON.stringify(body);
    if (s === lastSynced) return;
    syncing.value = true;
    try {
      dto.value = await patch(`/api/records/${recordId.value}`, body);
      lastSynced = s;
      syncErr.value = '';
    } catch (e) {
      syncErr.value = errorMessage(e);
      throw e;
    } finally {
      syncing.value = false;
    }
  });
  const p = syncChain;
  syncChain = syncChain.catch(() => undefined);
  return p;
}
function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(() => undefined), 800);
}
const syncSoft = () => syncNow().catch(() => undefined);

watch(
  form,
  (v) => {
    if (!ready.value || !editable.value) return;
    saveDraft(draftKey.value, v);
    scheduleSync();
  },
  { deep: true },
);

// ---------------------------------------------------------------- 사진
const pending = ref<File[]>([]);
const uploadBusy = ref(false);
const uploadErr = ref('');
const picker = ref<InstanceType<typeof PhotoPicker> | null>(null);

watch(pending, (v) => {
  if (draftKey.value && editable.value) saveDraftPhotos(draftKey.value, v);
});

async function uploadPending(rethrow = false) {
  if (!recordId.value || !pending.value.length || uploadBusy.value) return;
  uploadBusy.value = true;
  uploadErr.value = '';
  const files = pending.value.slice();
  const fd = new FormData();
  for (const f of files) fd.append('photos', f, f.name);
  try {
    dto.value = await api(`/api/records/${recordId.value}/photos`, { method: 'POST', form: fd });
    pending.value = [];
    await clearDraftPhotos(draftKey.value);
  } catch (e) {
    // photo_store_failed: 앞에서부터 저장된 장수만큼 빼고 나머지를 남긴다
    if (e instanceof ApiError && Array.isArray(e.body?.savedPhotoIds) && e.body.savedPhotoIds.length) {
      pending.value = files.slice(e.body.savedPhotoIds.length);
      get(`/api/records/${recordId.value}`)
        .then((d) => (dto.value = d))
        .catch(() => undefined);
    }
    uploadErr.value = errorMessage(e);
    if (rethrow) throw e;
  } finally {
    uploadBusy.value = false;
  }
}
function onPicked(files: File[]) {
  const added = files.length > pending.value.length;
  pending.value = files;
  if (added && editable.value) uploadPending().catch(() => undefined);
}

// ---------------------------------------------------------------- 저장 (G5)
const gate = ref<GateBlock | null>(null);
const invalid = ref<Set<string>>(new Set());
const saveBusy = ref(false);
const saveErr = ref('');
const savedNotice = ref<{ mismatch: boolean; schedule: boolean } | null>(null);
let saveKey = newIdempotencyKey();

const FIELD_LABEL: Record<string, string> = {
  location: '위치',
  defectType: '하자 종류',
  repairStatus: '보수 결과',
  aiMatch: 'AI 일치 여부',
  photo: '현장 사진',
};

async function save() {
  if (saveBusy.value || !recordId.value) return;
  saveBusy.value = true;
  saveErr.value = '';
  try {
    await syncNow();
    if (pending.value.length) await uploadPending(true);
    const r = await api(`/api/records/${recordId.value}/save`, {
      method: 'POST',
      body: scheduleId.value ? { scheduleId: scheduleId.value } : {},
      idempotencyKey: saveKey,
    });
    saveKey = newIdempotencyKey();
    gate.value = null;
    invalid.value = new Set();
    dto.value = r;
    clearDraft(draftKey.value);
    savedNotice.value = { mismatch: r.fields?.aiMatch === 'mismatch', schedule: !!r.completedScheduleId };
    window.scrollTo({ top: 0 });
  } catch (e) {
    if (e instanceof GateBlockError) {
      saveKey = newIdempotencyKey();
      gate.value = e.block;
      invalid.value = new Set(e.block.missingFields ?? []);
      await nextTick();
      document.getElementById('gate-block')?.scrollIntoView({ block: 'center' });
    } else if (!uploadErr.value) {
      saveErr.value = errorMessage(e);
    }
  } finally {
    saveBusy.value = false;
  }
}

function focusField(f: string) {
  const id: Record<string, string> = {
    location: 's3-loc-detail',
    defectType: 's3-dt-0',
    repairStatus: 's3-rs-completed',
    aiMatch: 's3-ai-match',
  };
  if (f === 'photo') {
    picker.value?.focus();
    document.getElementById('s3-photos')?.closest('.field')?.scrollIntoView({ block: 'center' });
    return;
  }
  const el = document.getElementById(id[f] ?? '');
  el?.focus();
  el?.closest('.field, fieldset')?.scrollIntoView({ block: 'center' });
}
function onGateAction(a: { id: string }) {
  if (a.id === 'goto-missing') {
    const first =
      ['location', 'defectType', 'repairStatus', 'aiMatch', 'photo'].find((f) => invalid.value.has(f)) ?? gate.value?.missingFields?.[0];
    if (first) focusField(first);
  }
}
// 입력하면 그 칸의 표시만 지운다(차단 블록은 다음 저장 시 서버 판정으로만 사라진다)
watch(locationText, (v) => v && invalid.value.delete('location'));
watch(
  () => form.value.defectTypeCode,
  (v) => v && invalid.value.delete('defectType'),
);
watch(
  () => form.value.repairStatus,
  (v) => v && invalid.value.delete('repairStatus'),
);
watch(
  () => form.value.aiMatch,
  (v) => v && invalid.value.delete('aiMatch'),
);
watch(
  () => dto.value?.photos?.length,
  (n) => n && invalid.value.delete('photo'),
);
const inv = (f: string) => (invalid.value.has(f) ? 'true' : undefined);

// ---------------------------------------------------------------- 저장 후: 보수 결과 갱신 (FR-034)
const repairMethodNew = ref('');
const repairBusy = ref(false);
const repairErr = ref('');
const repairDone = ref(false);
async function markRepaired() {
  if (!recordId.value || repairBusy.value) return;
  repairBusy.value = true;
  repairErr.value = '';
  try {
    dto.value = await patch(`/api/records/${recordId.value}/repair-status`, {
      repairStatus: 'completed',
      repairMethod: repairMethodNew.value.trim() || null,
    });
    repairDone.value = true;
    repairMethodNew.value = '';
  } catch (e) {
    repairErr.value = errorMessage(e);
  } finally {
    repairBusy.value = false;
  }
}

// ---------------------------------------------------------------- 저장 후: 추가 자료 요청 → 사진 추가로 해소 (FR-044)
const openRequests = computed(() => (dto.value?.dataRequests ?? []).filter((d: any) => d.open));
const reqPhotos = ref<File[]>([]);
const reqBusy = ref(false);
const reqErr = ref('');
const reqResult = ref('');
async function sendRequestPhotos() {
  if (!recordId.value || !reqPhotos.value.length || reqBusy.value) return;
  reqBusy.value = true;
  reqErr.value = '';
  reqResult.value = '';
  const fd = new FormData();
  for (const f of reqPhotos.value) fd.append('photos', f, f.name);
  try {
    const before = openRequests.value.length;
    dto.value = await api(`/api/records/${recordId.value}/photos`, { method: 'POST', form: fd });
    reqPhotos.value = [];
    const after = openRequests.value.length;
    reqResult.value =
      before > 0 && after === 0 ? '사진을 보냈습니다 - 추가 자료 요청이 해소되어 전문가 검증 대기로 돌아갔습니다' : '사진을 추가했습니다';
  } catch (e) {
    reqErr.value = errorMessage(e);
  } finally {
    reqBusy.value = false;
  }
}

// ================================================================= 시작
onMounted(async () => {
  reference.load().catch(() => undefined);
  await loadSchedule();
  if (recordId.value) await loadRecord();
  else if (buildingId.value) await loadBuilding(buildingId.value);
});
onBeforeUnmount(() => {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncSoft();
  }
});

const caseRail = computed(() => dto.value?.progress ?? null);
const VSTATUS: Record<string, { tone: 'info' | 'warn' | 'ok'; label: string }> = {
  waiting: { tone: 'info', label: '전문가 검증 대기' },
  data_requested: { tone: 'warn', label: '추가 자료 요청 중' },
  verified: { tone: 'ok', label: '전문가 검증 완료' },
};
const AI_MATCH: Record<string, string> = { match: '일치', mismatch: '불일치', none: '해당 없음' };
</script>

<template>
  <div>
    <C1ProgressRail v-if="caseRail" variant="case" :title="`하자 건 ${caseRail.caseNo}`" :stages="caseRail.stages" />
    <C1ProgressRail v-else-if="!recordId && rail" variant="building" :title="rail.buildingName" :counts="railCounts" />

    <div class="container page s3">
      <div class="page-head">
        <div>
          <p class="eyebrow">현장 점검·보수 기록</p>
          <h1 class="display-md">{{ recordId ? '현장 기록' : '새 현장 기록' }}</h1>
          <p v-if="dto" class="body-md muted" style="margin-top: 8px">{{ dto.building?.buildingName }} · {{ dto.caseNo }}</p>
        </div>
        <BaseButton variant="secondary" size="sm" to="/records">내 기록 목록</BaseButton>
      </div>

      <AlertBox v-if="scheduleInfo" tone="info" :title="`배정 점검 - ${scheduleInfo.itemText}`" class="mb">
        {{ scheduleInfo.buildingName }} · 기한 {{ fmtDate(scheduleInfo.dueDate)
        }}<template v-if="!dto || isDraft"> · 이 기록을 저장하면 일정이 완료됩니다</template>
      </AlertBox>

      <!-- ============================================================ 새 기록 -->
      <section v-if="!recordId" class="stack-lg new">
        <C8BuildingPicker v-model="buildingId" access="record" screen="S3" label="기록할 건물" />

        <template v-if="buildingId">
          <section class="stack" aria-labelledby="s3-hist-title">
            <h2 id="s3-hist-title" class="title-md">건물 이력 요약</h2>
            <C7SourceStatusBar :items="sourceItems" />
            <p v-if="railErr" class="body-sm muted">이력 요약을 불러오지 못했습니다 - {{ railErr }}</p>
            <div v-if="rail" class="specs">
              <SpecCell :value="rail.historyCount" label="누적 이력" />
              <SpecCell :value="rail.pendingRepairCount" label="보수 예정(미완료)" />
              <SpecCell :value="rail.overdueCount" label="지연 점검" :tone="rail.overdueCount ? 'alert' : 'default'" />
              <SpecCell :value="fmtDate(rail.lastRecordAt) || '-'" label="최근 기록일" />
            </div>
            <p v-if="rail?.byDefectType?.length" class="body-sm">
              <span class="muted">하자 종류별</span>
              <template v-for="(t, i) in rail.byDefectType" :key="t.code"
                ><span v-if="i" aria-hidden="true"> · </span>{{ t.name }} {{ t.count }}건</template
              >
            </p>
            <p v-if="!rail && !railErr" class="skeleton" style="height: 120px" aria-label="불러오는 중"></p>
          </section>

          <fieldset class="link-step" aria-describedby="s3-link-hint">
            <legend class="title-md">AI 분석 결과 연결</legend>
            <p id="s3-link-hint" class="hint body-sm muted">
              분석한 결과를 연결하면 사진·원인·대응방안이 기록에 함께 붙습니다. 계정에 연결되지 않은 비회원 결과는 목록에 없습니다.
            </p>
            <p v-if="linkLoading" class="skeleton" style="height: 96px" aria-label="불러오는 중"></p>
            <div v-else class="link-list">
              <label v-for="l in linkables" :key="l.resultId" class="choice check-row link-item">
                <input v-model="linkChoice" type="radio" name="s3-link" :value="String(l.resultId)" />
                <span class="link-text">
                  <span class="row">
                    <b>{{ l.caseNo }}</b>
                    <StatusBadge :tone="riskTone(l.riskLevel)" :label="RISK_LABEL[l.riskLevel] ?? l.riskLevel" />
                    <StatusBadge tone="ref" label="1차 참고용" />
                  </span>
                  <span class="caption">{{ l.topCause ?? '원인 정보 없음' }} · {{ fmtDate(l.completedAt) }}</span>
                </span>
              </label>
              <label class="choice check-row link-item">
                <input v-model="linkChoice" type="radio" name="s3-link" value="none" />
                <span class="link-text"
                  ><b>연결 없음 - 신규 하자</b><span class="caption">분석 없이 현장에서 발견한 하자를 바로 기록합니다</span></span
                >
              </label>
            </div>
          </fieldset>

          <C2GateBlock v-if="createGate" :block="createGate" />
          <RetryBox v-if="createErr" :message="createErr" :busy="createBusy" @retry="createRecord" />

          <div class="sticky-actions">
            <C3ReasonedButton block :busy="createBusy" :disabled="!!createReason" :reason="createReason" @click="createRecord"
              >기록 시작</C3ReasonedButton
            >
          </div>
        </template>
      </section>

      <!-- ============================================================ 기록 -->
      <template v-else>
        <RetryBox v-if="loadErr" :message="loadErr" :busy="loading" @retry="loadRecord" />
        <p v-if="loading && !dto" class="skeleton" style="height: 320px" aria-label="불러오는 중"></p>

        <template v-if="dto">
          <!-- 저장 결과 -->
          <AlertBox v-if="savedNotice" tone="ok" title="기록을 저장했습니다" class="mb">
            하자 종류 「{{ dto.fields.defectTypeName }}」 이력으로 분류되었습니다.
            <template v-if="savedNotice.mismatch"> AI 결과와 불일치 - 전문가 검증 대상으로 등록되었습니다.</template>
            <template v-if="savedNotice.schedule"> 배정 점검 일정이 완료 처리되었습니다.</template>
          </AlertBox>

          <!-- 연결된 분석 결과 (미리 채움) -->
          <section class="block" aria-labelledby="s3-linked-title">
            <h2 id="s3-linked-title" class="title-md">연결된 AI 분석 결과</h2>
            <AiResultBrief
              v-if="dto.prefill?.result"
              :result="dto.prefill.result"
              :photos="dto.prefill.photos"
              heading="분석 결과 - 기록에 함께 붙습니다"
            />
            <p v-else class="none">연결 없음 - 신규 하자</p>
          </section>

          <!-- ======================================== 초안 편집 -->
          <form v-if="editable" class="stack-lg" novalidate @submit.prevent="save">
            <C2GateBlock v-if="gate" :block="gate" :busy-action="null" @action="onGateAction">
              <template #missing="{ fields }">
                <li v-for="f in fields" :key="f"><StatusBadge tone="danger" :label="FIELD_LABEL[f] ?? f" /></li>
              </template>
            </C2GateBlock>

            <section class="req-block" aria-labelledby="s3-req-title">
              <h2 id="s3-req-title" class="title-md">필수 항목</h2>

              <div class="field">
                <label for="s3-btype">건물 유형</label>
                <input
                  id="s3-btype"
                  class="input"
                  :value="dto.building?.buildingTypeName ?? ''"
                  readonly
                  aria-describedby="s3-btype-hint"
                />
                <span id="s3-btype-hint" class="hint">건물의 속성 - 여기서 바꿀 수 없습니다</span>
              </div>

              <fieldset class="field fs" :class="{ bad: invalid.has('location') }">
                <legend class="field-label req">위치</legend>
                <div class="choice-group" role="group" aria-label="층">
                  <label v-for="fl in FLOORS" :key="fl" class="choice">
                    <input
                      v-model="form.floor"
                      type="radio"
                      name="s3-floor"
                      :value="fl"
                      @click="form.floor === fl && (form.floor = '')"
                    />{{ fl }}
                  </label>
                </div>
                <div class="choice-group" role="group" aria-label="방향">
                  <label v-for="d in DIRS" :key="d" class="choice">
                    <input v-model="form.dir" type="radio" name="s3-dir" :value="d" @click="form.dir === d && (form.dir = '')" />{{ d }}
                  </label>
                </div>
                <label for="s3-loc-detail" class="sr-only">위치 상세</label>
                <input
                  id="s3-loc-detail"
                  v-model="form.detail"
                  class="input"
                  maxlength="150"
                  placeholder="상세 위치 - 예: 외벽, 계단실 벽"
                  :aria-invalid="inv('location')"
                  aria-describedby="s3-loc-hint"
                  @blur="syncSoft"
                />
                <span id="s3-loc-hint" class="hint">저장될 위치: {{ locationText || '(비어 있음)' }}</span>
              </fieldset>

              <fieldset class="field fs" :class="{ bad: invalid.has('defectType') }" :aria-invalid="inv('defectType')">
                <legend class="field-label req">하자 종류</legend>
                <div class="choice-group">
                  <label v-for="(d, i) in reference.defectTypes" :key="d.code" class="choice">
                    <input
                      :id="`s3-dt-${i}`"
                      v-model="form.defectTypeCode"
                      type="radio"
                      name="s3-dt"
                      :value="d.code"
                      :aria-invalid="inv('defectType')"
                    />{{ d.name }}
                  </label>
                </div>
              </fieldset>

              <fieldset class="field fs" :class="{ bad: invalid.has('repairStatus') }" :aria-invalid="inv('repairStatus')">
                <legend class="field-label req">보수 결과</legend>
                <div class="choice-group two">
                  <label class="choice">
                    <input
                      id="s3-rs-completed"
                      v-model="form.repairStatus"
                      type="radio"
                      name="s3-rs"
                      value="completed"
                      :aria-invalid="inv('repairStatus')"
                    />보수 완료
                  </label>
                  <label class="choice">
                    <input
                      v-model="form.repairStatus"
                      type="radio"
                      name="s3-rs"
                      value="pending"
                      :aria-invalid="inv('repairStatus')"
                    />미완료 - 보수 예정
                  </label>
                </div>
                <span class="hint">미완료도 직접 선택해야 합니다 - 빈칸과 다릅니다</span>
              </fieldset>

              <fieldset class="field fs" :class="{ bad: invalid.has('aiMatch') }" :aria-invalid="inv('aiMatch')">
                <legend class="field-label" :class="{ req: linked }">AI 결과와 현장 판정</legend>
                <template v-if="linked">
                  <div class="choice-group two">
                    <label class="choice">
                      <input
                        id="s3-ai-match"
                        v-model="form.aiMatch"
                        type="radio"
                        name="s3-ai"
                        value="match"
                        :aria-invalid="inv('aiMatch')"
                      />일치
                    </label>
                    <label class="choice">
                      <input v-model="form.aiMatch" type="radio" name="s3-ai" value="mismatch" :aria-invalid="inv('aiMatch')" />불일치
                    </label>
                  </div>
                  <span v-if="form.aiMatch === 'mismatch'" class="hint strong">불일치 - 저장하면 전문가 검증 대상으로 등록됩니다</span>
                </template>
                <p v-else class="body-sm"><StatusBadge tone="na" label="해당 없음" /> 연결된 분석 결과가 없습니다</p>
              </fieldset>
            </section>

            <section class="stack" aria-labelledby="s3-photo-title">
              <h2 id="s3-photo-title" class="title-md">현장 사진과 점검 내용</h2>
              <div class="field" :class="{ bad: invalid.has('photo') }">
                <span class="field-label req">현장 사진</span>
                <div v-if="dto.photos.length" class="saved-photos">
                  <PhotoThumb v-for="p in dto.photos" :key="p.photoId" :photo="p" />
                </div>
                <span class="hint" aria-live="polite"
                  >{{ dto.photos.length ? `${dto.photos.length}장 저장됨` : '아직 저장된 사진이 없습니다'
                  }}<template v-if="uploadBusy"> · 사진 올리는 중</template></span
                >
                <PhotoPicker
                  id="s3-photos"
                  ref="picker"
                  :model-value="pending"
                  :max="10"
                  capture
                  label="현장 사진"
                  alt-prefix="올릴 현장 사진"
                  :invalid="invalid.has('photo')"
                  @update:model-value="onPicked"
                />
                <RetryBox v-if="uploadErr && pending.length" :message="uploadErr" keeps-input :busy="uploadBusy" @retry="uploadPending()" />
              </div>
              <div class="field">
                <label for="s3-note">점검 내용 <span class="muted">(선택)</span></label>
                <textarea
                  id="s3-note"
                  v-model="form.inspectionNote"
                  class="textarea"
                  maxlength="1000"
                  placeholder="예: 균열 폭 0.4mm, 길이 1.2m"
                  @blur="syncSoft"
                ></textarea>
              </div>
              <div class="field">
                <label for="s3-method">보수 방법 <span class="muted">(선택)</span></label>
                <input
                  id="s3-method"
                  v-model="form.repairMethod"
                  class="input"
                  maxlength="200"
                  placeholder="예: 에폭시 주입"
                  @blur="syncSoft"
                />
              </div>
              <label class="choice check-row">
                <input v-model="form.riskFlag" type="checkbox" />
                <span class="box" aria-hidden="true"></span>
                위험 표시 - 현장에서 위험해 보입니다
              </label>
            </section>

            <RetryBox v-if="syncErr" :message="syncErr" keeps-input :busy="syncing" @retry="syncSoft" />
            <RetryBox v-if="saveErr" :message="saveErr" keeps-input :busy="saveBusy" @retry="save" />

            <div class="sticky-actions">
              <BaseButton type="submit" block :busy="saveBusy">기록 저장</BaseButton>
              <p class="caption sync-line" aria-live="polite">
                {{
                  syncing ? '임시 저장 중' : syncErr ? '임시 저장 실패 - 이 기기에는 남아 있습니다' : '입력 내용은 자동으로 임시 저장됩니다'
                }}
              </p>
            </div>
          </form>

          <!-- ======================================== 읽기 전용 (저장됨 · 남의 초안) -->
          <template v-else>
            <p v-if="isDraft" class="body-sm muted mb">다른 사람이 작성 중인 기록입니다 - 작성자만 수정할 수 있습니다.</p>

            <!-- 추가 자료 요청 (FR-044) -->
            <section v-if="openRequests.length && isRecorder" class="block">
              <AlertBox tone="warn" title="추가 자료 요청">
                <span v-for="r in openRequests" :key="r.dataReqId" class="req-line"
                  >사유: {{ r.reason }} · {{ fmtDate(r.sentAt, true) }}</span
                >
                현장 사진을 추가하면 요청이 해소되고 전문가 검증 대기로 돌아갑니다.
              </AlertBox>
              <div class="field" style="margin-top: 12px">
                <span class="field-label">추가 현장 사진</span>
                <PhotoPicker id="s3-req-photos" v-model="reqPhotos" :max="10" capture label="재촬영 사진" alt-prefix="추가 현장 사진" />
              </div>
              <RetryBox v-if="reqErr" :message="reqErr" keeps-input :busy="reqBusy" @retry="sendRequestPhotos" />
              <div class="sticky-actions">
                <C3ReasonedButton
                  block
                  :busy="reqBusy"
                  :disabled="!reqPhotos.length"
                  reason="사진을 1장 이상 골라 주세요"
                  @click="sendRequestPhotos"
                  >사진 보내기</C3ReasonedButton
                >
              </div>
            </section>
            <AlertBox v-if="reqResult" tone="ok" title="추가 자료" class="mb">{{ reqResult }}</AlertBox>

            <section class="block" aria-labelledby="s3-view-title">
              <div class="row-between">
                <h2 id="s3-view-title" class="title-md">기록 내용</h2>
                <span class="row">
                  <StatusBadge v-if="isDraft" tone="info" label="작성 중" />
                  <StatusBadge v-else tone="ok" :label="`저장됨 ${fmtDate(dto.savedAt, true)}`" />
                  <StatusBadge
                    v-if="dto.verification"
                    :tone="VSTATUS[dto.verification.status]?.tone ?? 'na'"
                    :label="VSTATUS[dto.verification.status]?.label ?? dto.verification.status"
                  />
                  <StatusBadge v-if="dto.fields.riskFlag" tone="danger" label="위험 표시" />
                </span>
              </div>
              <div v-if="dto.photos.length" class="saved-photos">
                <PhotoThumb v-for="p in dto.photos" :key="p.photoId" :photo="p" />
              </div>
              <dl class="dl">
                <dt>건물</dt>
                <dd>{{ dto.building?.buildingName }} · {{ dto.building?.buildingTypeName }}</dd>
                <dt>위치</dt>
                <dd>{{ dto.fields.locationText ?? '-' }}</dd>
                <dt>하자 종류</dt>
                <dd>{{ dto.fields.defectTypeName ?? '-' }}</dd>
                <dt>보수 결과</dt>
                <dd>
                  {{
                    dto.fields.repairStatus === 'completed'
                      ? '보수 완료'
                      : dto.fields.repairStatus === 'pending'
                        ? '미완료 - 보수 예정'
                        : '-'
                  }}
                </dd>
                <dt>보수 방법</dt>
                <dd>{{ dto.fields.repairMethod ?? '-' }}</dd>
                <dt>점검 내용</dt>
                <dd>{{ dto.fields.inspectionNote ?? '-' }}</dd>
                <dt>AI 일치</dt>
                <dd>{{ AI_MATCH[dto.fields.aiMatch] ?? '-' }}</dd>
                <template v-if="dto.completedSchedule"
                  ><dt>배정 점검</dt>
                  <dd>{{ dto.completedSchedule.itemText }} - 완료 연결</dd></template
                >
              </dl>
            </section>

            <!-- 보수 결과 갱신 (pending → completed 만) -->
            <section v-if="!isDraft" class="block" aria-labelledby="s3-repair-title">
              <h2 id="s3-repair-title" class="title-md">보수 결과</h2>
              <AlertBox v-if="repairDone" tone="ok" title="보수 완료로 바꿨습니다">변경 이력에 남았습니다.</AlertBox>
              <template v-if="dto.fields.repairStatus === 'pending' && session.can('record.repair.update')">
                <div class="field">
                  <label for="s3-repair-method">보수 방법 <span class="muted">(선택)</span></label>
                  <input
                    id="s3-repair-method"
                    v-model="repairMethodNew"
                    class="input"
                    maxlength="200"
                    placeholder="예: 에폭시 주입 후 도장"
                  />
                </div>
                <RetryBox v-if="repairErr" :message="repairErr" keeps-input :busy="repairBusy" @retry="markRepaired" />
                <div>
                  <BaseButton :busy="repairBusy" @click="markRepaired">보수 완료로 변경</BaseButton>
                </div>
              </template>
              <p v-else-if="dto.fields.repairStatus === 'completed'" class="body-sm"><StatusBadge tone="ok" label="보수 완료" /></p>
              <div v-if="dto.repairLog.length">
                <h3 class="title-sm">변경 이력</h3>
                <ul class="log">
                  <li v-for="(l, i) in dto.repairLog" :key="i" class="body-sm">
                    {{ fmtDate(l.changedAt, true) }} · {{ l.oldStatus === 'pending' ? '미완료' : l.oldStatus }} →
                    {{ l.newStatus === 'completed' ? '완료' : l.newStatus }}
                  </li>
                </ul>
              </div>
            </section>

            <section v-if="dto.dataRequests.length" class="block" aria-labelledby="s3-dr-title">
              <h2 id="s3-dr-title" class="title-md">추가 자료 요청 이력</h2>
              <ul class="log">
                <li v-for="r in dto.dataRequests" :key="r.dataReqId" class="body-sm">
                  <StatusBadge :tone="r.open ? 'warn' : 'ok'" :label="r.open ? '요청 중' : '해소'" />
                  {{ r.reason }} · {{ fmtDate(r.sentAt, true)
                  }}<template v-if="r.resolvedAt"> → {{ fmtDate(r.resolvedAt, true) }}</template>
                </li>
              </ul>
            </section>
          </template>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.s3 {
  max-width: 760px;
}
.mb {
  margin-bottom: var(--s-md);
}
.block {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  margin-bottom: var(--s-lg);
}
.none {
  padding: var(--s-md);
  background: var(--surface-soft);
  font: var(--t-body-sm);
  color: var(--ink);
}
.specs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--s-sm);
}
.specs :deep(.v) {
  overflow-wrap: anywhere;
  font-size: clamp(20px, 6vw, 32px);
}
.link-step {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
}
.link-step legend {
  margin-bottom: var(--s-xs);
}
.link-list {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.link-item {
  align-items: flex-start;
}
.link-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.link-text .caption {
  overflow-wrap: anywhere;
}
.req-block {
  display: flex;
  flex-direction: column;
  gap: var(--s-lg);
  padding: var(--s-md);
  border: 1px solid var(--hairline);
  border-top: 2px solid var(--ink);
}
.fs {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.fs legend {
  margin-bottom: var(--s-xs);
}
.fs .choice-group + .choice-group,
.fs .choice-group + .input {
  margin-top: var(--s-xs);
}
.two .choice {
  flex: 1 1 0;
  justify-content: center;
}
.bad .choice,
.bad :deep(.drop) {
  border-color: var(--error);
}
.bad > .field-label,
.bad > legend {
  color: var(--error-text);
}
.hint.strong {
  color: var(--warning-text);
  font-weight: 700;
}
.saved-photos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: var(--s-xs);
}
.sync-line {
  margin-top: var(--s-xxs);
  text-align: center;
}
.req-line {
  display: block;
  font-weight: 700;
  color: var(--ink);
}
.log {
  display: flex;
  flex-direction: column;
  gap: var(--s-xxs);
  margin-top: var(--s-xxs);
}
.log li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-xs);
  align-items: center;
}
.dl dd {
  overflow-wrap: anywhere;
}
@media (max-width: 767px) {
  .specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .fs .choice {
    flex: 1 1 auto;
    justify-content: center;
  }
}
</style>
