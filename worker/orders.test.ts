import { describe, expect, it } from 'vitest';
import { newMerTradeNo } from './orders';

describe('newMerTradeNo', () => {
  it('is IP + Taipei timestamp + random, 20 chars, valid as the affiliate orderId (A-Z0-9, <= 50)', () => {
    expect(newMerTradeNo(new Date('2026-11-04T16:30:05Z'), () => 'abc123')).toBe('IP261105003005ABC123');
    expect(newMerTradeNo(new Date())).toMatch(/^IP\d{12}[0-9A-F]{6}$/);
  });
});
