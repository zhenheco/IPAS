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
      expect(page).toContain('最後更新日期：2026-11-05');
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
  it('footer links all three pages on every page, and terms links the privacy policy', () => {
    const base = read('src/layouts/Base.astro');
    expect(base).toContain('href="/terms/"');
    expect(base).toContain('href="/refund/"');
    expect(base).toContain('href="/privacy/"');
    expect(terms).toContain('href="/privacy/"');
  });
  it('refund eligibility ends only when a 模擬考 / 全真模考 / 錯題重做 session starts, not when 錯題本 / 弱點分析 / 讀書計畫 are opened', () => {
    for (const page of [terms, refund]) {
      expect(page).toContain('單科模考、全真模考或錯題重做');
      expect(page).toContain('開啟錯題本、弱點分析、讀書計畫不影響退款資格');
    }
    expect(refund).not.toContain('付費功能指：');
    expect(terms).not.toContain('首次使用付費功能的時間');
    for (const file of ['src/components/Pricing.tsx', 'src/components/Account.tsx']) expect(read(file)).not.toContain('未使用任何付費功能');
    expect(read('src/components/Pricing.tsx')).not.toContain('尚未使用任何付費功能');
  });
});

describe('隱私權政策 page', () => {
  const privacy = read('src/pages/privacy.astro');
  it('uses the same layout, operator and contact as the terms, with effective date 2026-11-05', () => {
    expect(privacy).toContain("import Base from '../layouts/Base.astro'");
    expect(privacy).toContain('<article class="legal">');
    expect(privacy).toContain('振禾有限公司');
    expect(privacy).toContain('83446730');
    expect(privacy).toContain('ace@zhenhe-dm.com');
    expect(privacy).toContain('生效日期：2026-11-05');
  });
  it('discloses what is collected and where payment is handled', () => {
    for (const t of ['Email', 'PAYUNi', '統一發票', '不接觸也不儲存', '訂單', 'session cookie', '瀏覽器']) expect(privacy).toContain(t);
  });
  it('carries the AdSense cookie disclosure and the Google ad settings opt-out', () => {
    expect(privacy).toContain('Google AdSense');
    expect(privacy).toContain('先前造訪');
    expect(privacy).toContain('href="https://adssettings.google.com"');
    expect(privacy).toContain('Google 廣告設定');
  });
  it('describes the sign-in cookie as valid about 7 days (may be extended), re-login after expiry, deleted on sign-out; makes no renew-on-every-use promise', () => {
    expect(privacy).toContain('此 cookie 有效期約 7 天，期間內可能因登入狀態更新而延長；到期後需重新登入，登出後即刪除。');
    expect(privacy).not.toContain('最後一次使用後 7 天');
    expect(privacy).not.toContain('持續使用本站就會自動延長');
    expect(privacy).not.toContain('最長保留 7 天');
  });
  it('ADR 0001 notes that the refund trigger was superseded by ADR 0003 on 2026-11-05', () => {
    const adr = read('docs/adr/0001-exam-pass-pricing.md');
    expect(adr).toContain('2026-11-05');
    expect(adr).toContain('0003-beginner-level-pass.md');
    expect(adr).toContain('開始單科模考、全真模考或錯題重做');
  });
  it('states purpose, retention, user rights and policy changes', () => {
    for (const t of ['使用目的', '保存期間', '查詢', '更正', '刪除', '政策變更']) expect(privacy).toContain(t);
  });
});

describe('ADMIN_EMAILS is a secret, not a committed var', () => {
  it('wrangler.app.jsonc does not carry it (the repo is public); .dev.vars.example documents it with a placeholder', () => {
    expect(read('wrangler.app.jsonc')).not.toContain('ADMIN_EMAILS');
    expect(read('.dev.vars.example')).toMatch(/^ADMIN_EMAILS=admin@example\.com$/m);
    expect(read('worker/env.ts')).toContain('ADMIN_EMAILS?: string');
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
