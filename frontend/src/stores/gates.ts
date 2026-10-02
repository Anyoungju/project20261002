import { defineStore } from 'pinia';
import { get } from '@/api/client';

export interface GateDef {
  gateCode: string;
  gateName: string;
  blockMessage: string;
  releaseParty: string;
}

/** FR-005 — 게이트 문구 단일 원천(gate_def). 프론트에 문구를 하드코딩하지 않는다 */
export const useGates = defineStore('gates', {
  state: () => ({ defs: {} as Record<string, GateDef>, loaded: false }),
  actions: {
    async load() {
      if (this.loaded) return;
      const rows = await get<GateDef[]>('/api/gates');
      this.defs = Object.fromEntries(rows.map((r) => [r.gateCode, r]));
      this.loaded = true;
    },
    messageOf(gate: string): string {
      return this.defs[gate]?.blockMessage ?? '';
    },
    releasePartyOf(gate: string): string {
      return this.defs[gate]?.releaseParty ?? '';
    },
  },
});
