import { describe, expect, it } from 'vitest';
import {
  PRICING, addDays, daysBetween, endOfTaipeiDay, entitlementsByLevel, isPurchasable, passValidity, quotePrice, refundEligibility, taipeiDate,
} from './pricing';

const EXAM = '2027-05-22';
/** 台灣時間某日中午 */
const tw = (ymd: string, hm = '12:00') => new Date(`${ymd}T${hm}:00+08:00`);

describe('date helpers', () => {
  it('uses the Taipei calendar day', () => {
    expect(taipeiDate(new Date('2026-11-04T15:59:59Z'))).toBe('2026-11-04');
    expect(taipeiDate(new Date('2026-11-04T16:00:00Z'))).toBe('2026-11-05');
  });
  it('counts and adds days', () => {
    expect(daysBetween('2026-11-04', '2026-11-14')).toBe(10);
    expect(addDays('2026-11-14', 30)).toBe('2026-12-14');
    expect(addDays('2027-02-27', 2)).toBe('2027-03-01');
    expect(() => daysBetween('2026/11/04', '2026-11-14')).toThrow();
  });
  it('end of Taipei day', () => {
    expect(endOfTaipeiDay('2026-12-14')).toBe('2026-12-14T15:59:59.999Z');
  });
});

describe('quotePrice', () => {
  const q = (now: Date, hasPriorPaidPass = false, level: 'beginner' | 'intermediate' = 'intermediate') => quotePrice({ level, examDate: EXAM, now, hasPriorPaidPass });
  it('regular NT$590 inside 45 days', () => {
    expect(q(tw(addDays(EXAM, -44)))).toMatchObject({ priceType: 'regular', amount: 590 });
    expect(q(tw(EXAM))).toMatchObject({ priceType: 'regular', amount: 590 });
  });
  it('early bird NT$490 at exactly 45 days (inclusive) and earlier', () => {
    expect(q(tw(addDays(EXAM, -45), '00:00'))).toMatchObject({ priceType: 'early', amount: 490 });
    expect(q(tw(addDays(EXAM, -45), '23:59'))).toMatchObject({ priceType: 'early', amount: 490 });
    expect(q(tw(addDays(EXAM, -200)))).toMatchObject({ priceType: 'early', amount: 490 });
  });
  it('early bird boundary follows Taipei time, not UTC', () => {
    // 2027-04-07 23:30 台灣 = 15:30Z（仍為前 45 天）；隔日 00:30 台灣 = 前一天 16:30Z（已是前 44 天）
    expect(q(new Date('2027-04-07T15:30:00Z')).priceType).toBe('early');
    expect(q(new Date('2027-04-07T16:30:00Z')).priceType).toBe('regular');
  });
  it('renewal NT$390 wins over early bird and regular (lowest applicable)', () => {
    expect(q(tw(addDays(EXAM, -100)), true)).toMatchObject({ priceType: 'renewal', amount: 390 });
    expect(q(tw(addDays(EXAM, -1)), true)).toMatchObject({ priceType: 'renewal', amount: 390 });
    expect(q(tw(addDays(EXAM, -100)), true).applicable.map((a) => a.priceType)).toEqual(['renewal', 'early', 'regular']);
  });
  it('picks the lowest even if config makes early cheaper than renewal', () => {
    const saved = { ...PRICING.prices.beginner };
    const p = PRICING.prices.beginner as { regular: number; early: number; renewal: number };
    p.early = 300;
    try { expect(q(tw(addDays(EXAM, -100)), true, 'beginner')).toMatchObject({ priceType: 'early', amount: 300 }); }
    finally { Object.assign(p, saved); }
  });
  it('beginner defaults to the intermediate prices', () => {
    expect(PRICING.prices.beginner).toEqual(PRICING.prices.intermediate);
  });
});

describe('passValidity', () => {
  it('runs from purchase until the end of exam day + 30 (Taipei)', () => {
    const bought = new Date('2026-10-01T03:00:00.000Z');
    expect(passValidity('2026-11-14', bought)).toEqual({ validFrom: '2026-10-01T03:00:00.000Z', validUntil: '2026-12-14T15:59:59.999Z' });
  });
});

describe('isPurchasable', () => {
  it('open through exam day (Taipei), closed after or when sale is off', () => {
    expect(isPurchasable({ examDate: EXAM, saleOpen: true }, tw(EXAM, '23:59'))).toBe(true);
    expect(isPurchasable({ examDate: EXAM, saleOpen: true }, tw(addDays(EXAM, 1), '00:00'))).toBe(false);
    expect(isPurchasable({ examDate: EXAM, saleOpen: false }, tw(addDays(EXAM, -60)))).toBe(false);
  });
});

describe('refundEligibility', () => {
  const paidAt = '2026-10-01T00:00:00.000Z';
  const base = { status: 'paid', paidAt, firstPaidFeatureUsedAt: null, refundRequestedAt: null };
  const at = (ms: number) => new Date(Date.parse(paidAt) + ms);
  const DAY = 86_400_000;
  it('eligible within 7×24h and no paid feature used', () => {
    expect(refundEligibility({ ...base, now: at(0) })).toEqual({ eligible: true });
    expect(refundEligibility({ ...base, now: at(7 * DAY) })).toEqual({ eligible: true });
  });
  it('not eligible after 7 days', () => {
    expect(refundEligibility({ ...base, now: at(7 * DAY + 1) })).toEqual({ eligible: false, reason: 'window_passed' });
  });
  it('not eligible once a paid feature is used', () => {
    expect(refundEligibility({ ...base, firstPaidFeatureUsedAt: paidAt, now: at(1000) })).toEqual({ eligible: false, reason: 'feature_used' });
  });
  it('not eligible for unpaid/refunded orders or repeated requests', () => {
    expect(refundEligibility({ ...base, status: 'pending', paidAt: null, now: at(0) })).toEqual({ eligible: false, reason: 'not_paid' });
    expect(refundEligibility({ ...base, status: 'refunded', now: at(0) })).toEqual({ eligible: false, reason: 'not_paid' });
    expect(refundEligibility({ ...base, refundRequestedAt: paidAt, now: at(0) })).toEqual({ eligible: false, reason: 'already_requested' });
  });
});

describe('entitlementsByLevel', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  const pass = (level: 'beginner' | 'intermediate', validFrom: string, validUntil: string, revokedAt: string | null = null) => ({ level, validFrom, validUntil, revokedAt });
  it('per level; ignores expired, future and revoked passes; takes latest validUntil', () => {
    const e = entitlementsByLevel([
      pass('intermediate', '2026-10-01T00:00:00.000Z', '2026-12-14T15:59:59.999Z'),
      pass('intermediate', '2026-10-02T00:00:00.000Z', '2027-06-21T15:59:59.999Z'),
      pass('beginner', '2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
      pass('beginner', '2026-10-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', '2026-10-03T00:00:00.000Z'),
    ], now);
    expect(e).toEqual({ intermediate: { paid: true, validUntil: '2027-06-21T15:59:59.999Z' }, beginner: { paid: false, validUntil: null } });
  });
  it('empty', () => {
    expect(entitlementsByLevel([], now)).toEqual({ intermediate: { paid: false, validUntil: null }, beginner: { paid: false, validUntil: null } });
  });
});
