import crypto from 'node:crypto';
import { env } from '../../config/env';

/** research R11 — PaymentGateway 경계. 실제 PG 는 계약 후 어댑터 추가 */
export interface CheckoutInfo {
  pgTxRef: string;
  /** mock 은 카드 번호 입력 단계를 프론트에서 그린다 */
  mode: 'mock';
}

export interface ConfirmResult {
  approved: boolean;
  declineReason?: string;
  pgTxRef: string;
}

export interface PaymentGateway {
  createCheckout(paymentId: number, amount: number): Promise<CheckoutInfo>;
  confirm(pgTxRef: string, payload: { cardNumber?: string }): Promise<ConfirmResult>;
  parseWebhook(rawBody: string, signature: string | undefined): { pgTxRef: string; approved: boolean; declineReason?: string } | null;
}

/** 테스트 카드: 4000-0000-0000-0002 → 거절(한도 초과), 4000-0000-0000-0069 → 거절(카드사 거절), 그 외 16자리 승인 */
export const MOCK_DECLINES: Record<string, string> = {
  '4000000000000002': '카드 한도가 초과되었습니다',
  '4000000000000069': '카드사가 결제를 거절했습니다',
};

export class MockPaymentGateway implements PaymentGateway {
  async createCheckout(paymentId: number): Promise<CheckoutInfo> {
    return { pgTxRef: `mock_${paymentId}_${crypto.randomBytes(6).toString('hex')}`, mode: 'mock' };
  }
  async confirm(pgTxRef: string, payload: { cardNumber?: string }): Promise<ConfirmResult> {
    const card = (payload.cardNumber ?? '').replace(/\D/g, '');
    await new Promise((r) => setTimeout(r, 300));
    if (card.length !== 16) return { approved: false, declineReason: '카드 번호 16자리를 확인해 주세요', pgTxRef };
    const decline = MOCK_DECLINES[card];
    return decline ? { approved: false, declineReason: decline, pgTxRef } : { approved: true, pgTxRef };
  }
  parseWebhook(rawBody: string, signature: string | undefined) {
    const expect = crypto.createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
    if (!signature || signature.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expect)))
      return null;
    try {
      const j = JSON.parse(rawBody);
      return { pgTxRef: String(j.pgTxRef), approved: !!j.approved, declineReason: j.declineReason };
    } catch {
      return null;
    }
  }
}

let gw: PaymentGateway | null = null;
export function paymentGateway(): PaymentGateway {
  if (!gw) gw = new MockPaymentGateway();
  return gw;
}
