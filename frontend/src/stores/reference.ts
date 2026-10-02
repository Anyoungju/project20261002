import { defineStore } from 'pinia';
import { get } from '@/api/client';

export interface Code {
  code: string;
  name: string;
}

export const useReference = defineStore('reference', {
  state: () => ({ defectTypes: [] as Code[], buildingTypes: [] as Code[], specialties: [] as Code[], cycles: [] as Code[], loaded: false }),
  actions: {
    async load() {
      if (this.loaded) return;
      const r = await get('/api/codes');
      Object.assign(this, r);
      this.loaded = true;
    },
    defectName(code?: string | null) {
      return this.defectTypes.find((d) => d.code === code)?.name ?? code ?? '';
    },
  },
});
