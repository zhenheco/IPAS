import { describe, expect, it } from 'vitest';
import { paymentNotice } from './paymentReturn';

// affiliate 303 導回 callbackUrl 時帶 ?paymentId&orderId&status=success|failed|pending；orderId 即本站 merchant_trade_no
const order = (merchantTradeNo: string, status: 'pending' | 'paid' | 'failed' | 'refunded') => ({ id: `id-${merchantTradeNo}`, merchantTradeNo, status });
const pass = (merchantTradeNo: string, revokedAt: string | null = null) => ({ orderId: `id-${merchantTradeNo}`, revokedAt });
const PAID_OTHER = [order('IP-OLD', 'paid')];
const PASS_OTHER = [pass('IP-OLD')];

describe('paymentNotice', () => {
  it('shows nothing without a recognised status', () => {
    expect(paymentNotice('', [], [])).toBeNull();
    expect(paymentNotice('?status=hax', [], [])).toBeNull();
    expect(paymentNotice('?payment=paid', [], [])).toBeNull();
  });
  it('success says 已開通 only when the returned orderId is a paid order with an active (non-revoked) pass attached to that order', () => {
    expect(paymentNotice('?paymentId=p&orderId=IP-NEW&status=success', [order('IP-NEW', 'paid'), ...PAID_OTHER], [pass('IP-NEW'), ...PASS_OTHER])).toEqual({ warn: false, text: expect.stringContaining('已開通') });
  });
  it('a paid order whose pass is missing or revoked is 確認中, not 已開通', () => {
    for (const passes of [PASS_OTHER, [pass('IP-NEW', '2026-09-01T00:00:00.000Z'), ...PASS_OTHER], []]) {
      const n = paymentNotice('?orderId=IP-NEW&status=success', [order('IP-NEW', 'paid'), ...PAID_OTHER], passes);
      expect(n).toMatchObject({ warn: true });
      expect(n?.text).not.toContain('已開通');
    }
  });
  it('success with an older paid order but the returned order not yet paid (webhook not landed) is 確認中, not 已開通', () => {
    for (const orders of [PAID_OTHER, [...PAID_OTHER, order('IP-NEW', 'pending')], [order('IP-NEW', 'failed')], [order('IP-NEW', 'refunded')], []]) {
      const n = paymentNotice('?paymentId=p&orderId=IP-NEW&status=success', orders, PASS_OTHER);
      expect(n).toMatchObject({ warn: true });
      expect(n?.text).not.toContain('已開通');
      expect(n?.text).toContain('確認');
    }
  });
  it('success without an orderId never claims 已開通', () => {
    expect(paymentNotice('?status=success', [order('IP-NEW', 'paid')], [pass('IP-NEW')])?.text).not.toContain('已開通');
  });
  it('maps failed and pending regardless of orders', () => {
    expect(paymentNotice('?orderId=IP-NEW&status=failed', PAID_OTHER, PASS_OTHER)).toMatchObject({ warn: true, text: expect.stringContaining('未完成') });
    expect(paymentNotice('?orderId=IP-NEW&status=pending', PAID_OTHER, PASS_OTHER)).toMatchObject({ warn: true, text: expect.stringContaining('入帳') });
  });
});
