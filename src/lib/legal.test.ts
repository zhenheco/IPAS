import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The repo has no DOM test environment, so the 服務條款／退款政策 pages and their entry points are checked at source level.
const read = (p: string) => readFileSync(join(import.meta.dirname, '..', '..', p), 'utf8');

describe('服務條款 and 退款政策 pages', () => {
  const terms = read('src/pages/terms.astro');
  const refund = read('src/pages/refund.astro');

  it('both carry the 最後更新日期 and the contact email', () => {
    for (const page of [terms, refund]) {
      expect(page).toContain('最後更新日期：2026-11-04');
      expect(page).toContain('ace@zhenhe-dm.com');
    }
  });
  it('refund page states the invoice issuer and the no-7-day-review-period policy', () => {
    expect(refund).toContain('83446730');
    expect(refund).toContain('PAYUNi');
    expect(refund).toContain('消費者保護法第19條第2項');
    expect(refund).toContain('通訊交易解除權合理例外情事適用準則');
  });
  it('refund page takes its window from PRICING instead of a copied number', () => {
    expect(refund).toContain('PRICING.refundWindowDays');
    expect(terms).toContain('PRICING.validDaysAfterExam');
  });
  it('ads are described per 級別: hidden only on the 級別 the member holds a valid pass for (ADR 0003)', () => {
    expect(terms).toContain('只有在你持有有效考期通行證的級別頁面不顯示廣告');
    expect(terms).not.toContain('付費會員不顯示廣告');
    expect(refund).toContain('該級別');
    expect(read('src/components/Pricing.tsx')).toContain('持有通行證的級別不顯示廣告');
  });
  it('footer links both pages on every page', () => {
    const base = read('src/layouts/Base.astro');
    expect(base).toContain('href="/terms/"');
    expect(base).toContain('href="/refund/"');
  });
});

describe('checkout consent', () => {
  const pricing = read('src/components/Pricing.tsx');
  it('the consent checkbox is required, posts as `consent`, and names the terms, the refund policy and the immediate delivery', () => {
    expect(pricing).toMatch(/<input type="checkbox" name="consent" value="on" required \/>/);
    expect(pricing).toContain('同意服務條款與退款政策，並同意數位內容於付款後立即提供、不適用 7 天猶豫期');
    expect(pricing).toContain('href="/terms/"');
    expect(pricing).toContain('href="/refund/"');
  });
  it('the paywall card links to both pages', () => {
    const paywall = read('src/components/Paywall.tsx');
    expect(paywall).toContain('href="/terms/"');
    expect(paywall).toContain('href="/refund/"');
  });
});
