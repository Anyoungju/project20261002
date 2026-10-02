import type { Express } from 'express';
import { authRouter } from './modules/auth/authRouter';
import { referenceRouter } from './modules/reference/referenceRouter';
import { permissionRouter } from './modules/permission/permissionRouter';
import { notificationRouter } from './modules/notification/notificationRouter';
import { analysisRouter, meRouter } from './modules/analysis/analysisRouter';
import { caseRouter, photoRouter } from './modules/case/caseRouter';
import { planRouter, paymentRouter, linkGuestRouter } from './modules/entitlement/entitlementRouter';
import { buildingRouter } from './modules/building/buildingRouter';
import { recordRouter } from './modules/record/recordRouter';
import { verificationRouter, trustRouter } from './modules/verification/verificationRouter';
import { buildingScheduleRouter, scheduleRouter, assignmentRouter } from './modules/schedule/scheduleRouter';
import { riskNoticeRouter, expertRequestRouter, expertAttemptRouter, myExpertAttemptsRouter } from './modules/expert/expertRouter';
import { orgRouter, priorityRouter } from './modules/priority/priorityRouter';
import { adminRouter } from './modules/admin/adminRouter';

/** 계약 contracts/openapi.yaml 경로와 1:1 */
export function mountApi(app: Express): void {
  app.use('/api/auth/link-guest', linkGuestRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', referenceRouter); // /api/gates · /api/codes · /api/notices/current
  app.use('/api/permission-requests', permissionRouter);
  app.use('/api/me/notifications', notificationRouter);
  app.use('/api/me/assignments', assignmentRouter);
  app.use('/api/me/expert-attempts', myExpertAttemptsRouter);
  app.use('/api/me', meRouter); // /api/me/entitlements · /api/me/cases
  app.use('/api/analysis-requests', analysisRouter);
  app.use('/api/cases', caseRouter);
  app.use('/api/photos', photoRouter);
  app.use('/api/plans', planRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api/buildings/:buildingId/schedules', buildingScheduleRouter);
  app.use('/api/buildings', buildingRouter);
  app.use('/api/records', recordRouter);
  app.use('/api/verification-items', verificationRouter);
  app.use('/api/trust-metrics', trustRouter);
  app.use('/api/schedules', scheduleRouter);
  app.use('/api/risk-notices', riskNoticeRouter);
  app.use('/api/expert-requests', expertRequestRouter);
  app.use('/api/expert-attempts', expertAttemptRouter);
  app.use('/api/org', orgRouter);
  app.use('/api/priority-runs', priorityRouter);
  app.use('/api/admin', adminRouter);
}
