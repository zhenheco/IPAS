import { describe, expect, it } from 'vitest';
import { FREE_FEATURES, PAID_FEATURES, PAYWALL_ENABLED, canUse, countsAsPaidUse, isPaidFeature, shouldShowAds, shouldShowUpgradePrompt, type EntitlementMap, type Feature } from './entitlement';

const none: EntitlementMap = { beginner: { paid: false, validUntil: null }, intermediate: { paid: false, validUntil: null } };
const mid: EntitlementMap = { ...none, intermediate: { paid: true, validUntil: '2026-12-14T15:59:59.999Z' } };

describe('feature boundary', () => {
  it('paywall is off unless PUBLIC_PAYWALL_ENABLED=1', () => {
    expect(PAYWALL_ENABLED).toBe(false);
  });
  it('free = 練習 + 作答歷史; everything else paid', () => {
    expect(FREE_FEATURES).toEqual(['practice', 'history']);
    for (const f of ['exam', 'full', 'wrongbook', 'redo', 'weakness', 'plan', 'noAds'] as Feature[]) expect(isPaidFeature(f)).toBe(true);
    expect(isPaidFeature('practice')).toBe(false);
  });
  it('無廣告 is a passive perk, not a paid-feature use', () => {
    expect(PAID_FEATURES.filter(countsAsPaidUse)).toEqual(['exam', 'full', 'wrongbook', 'redo', 'weakness', 'plan']);
  });
  it('canUse: everything when paywall disabled', () => {
    expect(canUse('exam', 'intermediate', null, false)).toBe(true);
  });
  it('canUse: free features always, paid features per level', () => {
    expect(canUse('practice', 'intermediate', null, true)).toBe(true);
    expect(canUse('history', 'beginner', none, true)).toBe(true);
    expect(canUse('exam', 'intermediate', null, true)).toBe(false);
    expect(canUse('exam', 'intermediate', mid, true)).toBe(true);
    expect(canUse('exam', 'beginner', mid, true)).toBe(false);
  });
});

describe('shouldShowUpgradePrompt (每日至多一次，台灣日曆日)', () => {
  const t = (iso: string) => Date.parse(iso);
  it('shows when never shown or invalid', () => {
    expect(shouldShowUpgradePrompt(null, t('2026-11-04T00:00:00Z'))).toBe(true);
    expect(shouldShowUpgradePrompt(undefined, new Date())).toBe(true);
    expect(shouldShowUpgradePrompt('garbage', new Date())).toBe(true);
  });
  it('not again on the same Taipei day', () => {
    expect(shouldShowUpgradePrompt(t('2026-11-04T00:30:00+08:00'), t('2026-11-04T23:59:00+08:00'))).toBe(false);
  });
  it('again after Taipei midnight even if <24h', () => {
    expect(shouldShowUpgradePrompt('2026-11-04T23:50:00+08:00', t('2026-11-05T00:10:00+08:00'))).toBe(true);
  });
  it('does not show if the clock went backwards', () => {
    expect(shouldShowUpgradePrompt(t('2026-11-05T10:00:00+08:00'), t('2026-11-04T10:00:00+08:00'))).toBe(false);
  });
});

describe('shouldShowAds', () => {
  it('only with paywall on, AdSense configured and not paid', () => {
    expect(shouldShowAds({ paywallEnabled: false, adClient: 'ca-pub-1', ent: none })).toBe(false);
    expect(shouldShowAds({ paywallEnabled: true, adClient: undefined, ent: none })).toBe(false);
    expect(shouldShowAds({ paywallEnabled: true, adClient: '', ent: none })).toBe(false);
    expect(shouldShowAds({ paywallEnabled: true, adClient: 'ca-pub-1', ent: null })).toBe(true);
    expect(shouldShowAds({ paywallEnabled: true, adClient: 'ca-pub-1', ent: none })).toBe(true);
    expect(shouldShowAds({ paywallEnabled: true, adClient: 'ca-pub-1', ent: mid })).toBe(false);
    expect(shouldShowAds({ paywallEnabled: true, adClient: 'ca-pub-1', ent: mid, level: 'beginner' })).toBe(true);
    expect(shouldShowAds({ paywallEnabled: true, adClient: 'ca-pub-1', ent: mid, level: 'intermediate' })).toBe(false);
  });
});
