import { registerJob } from './scheduler';
import { runP0Watch } from '../modules/schedule/scheduleService';
import { runNoResponse } from '../modules/expert/expertService';
import { syncAllBuildings } from '../modules/building/buildingService';
import { recoverStuckAnalyses } from '../modules/analysis/analysisService';

/** R13 — P0 매일 01:00 + 매시 정각, G10 무응답 매시, BMS 매일 02:00 */
export function registerAllJobs(): void {
  registerJob('p0', '0 * * * *', runP0Watch);
  registerJob('no-response', '5 * * * *', runNoResponse);
  registerJob('bms-sync', '0 2 * * *', syncAllBuildings);
  registerJob('recover-analysis', '*/5 * * * *', recoverStuckAnalyses);
}

export const JOBS: Record<string, () => Promise<unknown>> = {
  p0: runP0Watch,
  'no-response': runNoResponse,
  'bms-sync': syncAllBuildings,
  'recover-analysis': recoverStuckAnalyses,
};
