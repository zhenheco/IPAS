import { describe, expect, it } from 'vitest';
import { ORIGIN, harness } from './test/harness';

const post = (h: ReturnType<typeof harness>, body: unknown, headers: Record<string, string> = {}) =>
  h.fetchApp('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '1.2.3.4', ...headers }, body: JSON.stringify(body) });

describe('/api/contact', () => {
  it('emails the owner with the visitor email, page and message', async () => {
    const h = harness();
    const r = await post(h, { email: 'v@example.com', message: '第 3 題答案有誤', page: '/practice/' });
    expect(r.status).toBe(200);
    const m = h.mailer.sent.at(-1)!;
    expect(m.to).toBe('ace@zhenheai.com');
    expect(m.subject).toContain('v@example.com');
    expect(m.text).toContain('第 3 題答案有誤');
    expect(m.text).toContain('/practice/');
    expect(m.kind).toBe('contact');
  });
  it('escapes visitor input in the html body', async () => {
    const h = harness();
    await post(h, { email: 'v@example.com', message: '<script>x</script>' });
    expect(h.mailer.sent.at(-1)!.html).not.toContain('<script>');
  });
  it('rejects cross-origin, invalid email and empty or oversized message', async () => {
    const h = harness();
    expect((await post(h, { email: 'v@example.com', message: 'hi' }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await post(h, { email: 'nope', message: 'hi' })).status).toBe(400);
    expect((await post(h, { email: 'v@example.com', message: '  ' })).status).toBe(400);
    expect((await post(h, { email: 'v@example.com', message: 'x'.repeat(2001) })).status).toBe(400);
    expect(h.mailer.sent.filter((m) => m.kind === 'contact')).toHaveLength(0);
  });
  it('silently drops honeypot submissions', async () => {
    const h = harness();
    const r = await post(h, { email: 'v@example.com', message: 'buy now', website: 'http://spam' });
    expect(r.status).toBe(200);
    expect(h.mailer.sent).toHaveLength(0);
  });
  it('returns 429 when the rate limiter refuses the IP', async () => {
    const keys: string[] = [];
    const h = harness({ env: { CONTACT_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } } });
    expect((await post(h, { email: 'v@example.com', message: 'hi' })).status).toBe(429);
    expect(keys).toEqual(['1.2.3.4']);
    expect(h.mailer.sent).toHaveLength(0);
  });
  it('returns 502 when sending fails', async () => {
    const h = harness();
    h.mailer.send = async () => { throw new Error('down'); };
    expect((await post(h, { email: 'v@example.com', message: 'hi' })).status).toBe(502);
  });
});
