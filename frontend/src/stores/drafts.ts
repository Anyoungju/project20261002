/**
 * research R14 · FR-102 — 입력값 보존. 텍스트는 localStorage(300ms 디바운스), 사진은 IndexedDB.
 * 키 = 화면 + 대상 id. 저장 성공 시 지운다.
 */
import { watch, type Ref } from 'vue';

const PREFIX = 'bc:draft:';

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 저장 공간 부족 등 — 무시 */
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* noop */
  }
  void clearDraftPhotos(key);
}

/** ref 를 자동으로 초안에 저장(300ms 디바운스) */
export function useDraft<T extends object>(key: () => string | null, model: Ref<T>): { restore: () => boolean } {
  let t: ReturnType<typeof setTimeout> | null = null;
  watch(
    model,
    (v) => {
      const k = key();
      if (!k) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => saveDraft(k, v), 300);
    },
    { deep: true },
  );
  return {
    restore() {
      const k = key();
      if (!k) return false;
      const d = loadDraft<T>(k);
      if (d) {
        Object.assign(model.value, d);
        return true;
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------- IndexedDB (사진)
const DB_NAME = 'buildcare-drafts';
const STORE = 'photos';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDraftPhotos(key: string, files: Array<Blob & { name?: string }>): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(
        files.map((f) => ({ blob: f, name: (f as File).name ?? 'photo.jpg', type: f.type })),
        PREFIX + key,
      );
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* 사파리 사생활 보호 모드 등 */
  }
}

export async function loadDraftPhotos(key: string): Promise<File[]> {
  try {
    const db = await openDb();
    const rows = await new Promise<any[]>((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(PREFIX + key);
      r.onsuccess = () => res(r.result ?? []);
      r.onerror = () => rej(r.error);
    });
    return rows.map((x) => new File([x.blob], x.name, { type: x.type }));
  } catch {
    return [];
  }
}

export async function clearDraftPhotos(key: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(PREFIX + key);
  } catch {
    /* noop */
  }
}
