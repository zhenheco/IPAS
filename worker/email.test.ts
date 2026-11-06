import { describe, expect, it, vi } from 'vitest';
import { CfEmailSender, ConsoleEmailSender, contactEmail, emailSenderFromEnv, magicLinkEmail } from './email';

const fetcher = (res: Response) => {
  const fetch = vi.fn(async (_u: string, _i: RequestInit) => res.clone());
  return { fetch } as unknown as { fetch: typeof fetch } & import('@cloudflare/workers-types').Fetcher;
};
const ok = () => new Response(JSON.stringify({ id: 'e1', status: 'pending' }), { status: 200 });
const msg = magicLinkEmail('a@example.com', 'https://x/y?t=1');

describe('CfEmailSender', () => {
  it('POSTs the v1 body to /send with API key and idempotency key', async () => {
    const f = fetcher(ok());
    await new CfEmailSender(f, 'KEY', 'no-reply@zhenhe-co.com').send(msg);
    const [url, init] = f.fetch.mock.calls[0];
    expect(new URL(url).pathname).toBe('/send');
    expect(init.method).toBe('POST');
    const h = init.headers as Record<string, string>;
    expect(h['X-API-Key']).toBe('KEY');
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Idempotency-Key']).toMatch(/^ipas:magic-link:[0-9a-f]{64}$/);
    expect(JSON.parse(init.body as string)).toEqual({
      to: 'a@example.com', from: 'no-reply@zhenhe-co.com', subject: msg.subject, text: msg.text, html: msg.html, tags: ['ipas', 'magic-link'],
    });
  });

  it('uses the message kind in idempotency key and tags', async () => {
    const f = fetcher(ok());
    await new CfEmailSender(f, 'KEY', 'no-reply@zhenhe-co.com').send(contactEmail('o@example.com', 'v@example.com', 'hi'));
    const [, init] = f.fetch.mock.calls[0];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^ipas:contact:[0-9a-f]{64}$/);
    expect(JSON.parse(init.body as string).tags).toEqual(['ipas', 'contact']);
  });

  it('idempotency key is stable for identical messages and differs for different ones', async () => {
    const f = fetcher(ok());
    const s = new CfEmailSender(f, 'KEY', 'no-reply@zhenhe-co.com');
    await s.send(msg);
    await s.send({ ...msg });
    await s.send(magicLinkEmail('a@example.com', 'https://x/y?t=2'));
    const keys = f.fetch.mock.calls.map((c) => (c[1].headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('throws with status and body on non-OK', async () => {
    const f = fetcher(new Response('{"error":{"code":"boom","message":"bad"}}', { status: 500 }));
    await expect(new CfEmailSender(f, 'KEY', 'f@zhenhe-co.com').send(msg)).rejects.toThrow(/500.*boom/);
  });

  it('throws on a Cloudflare platform block body', async () => {
    const f = fetcher(new Response('error code: 1042', { status: 404 }));
    await expect(new CfEmailSender(f, 'KEY', 'f@zhenhe-co.com').send(msg)).rejects.toThrow(/404.*1042/);
  });

  it('gives a clear message for recipient_suppressed', async () => {
    const f = fetcher(new Response('{"error":{"code":"recipient_suppressed","message":"x"}}', { status: 403 }));
    await expect(new CfEmailSender(f, 'KEY', 'f@zhenhe-co.com').send(msg)).rejects.toThrow(/suppress/i);
  });

  const KEY = 'sekrit-key-123';
  const errOf = async (f: ReturnType<typeof fetcher>) => {
    const e = await new CfEmailSender(f, KEY, 'f@zhenhe-co.com').send(msg).then(() => null, (x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    return e!.message;
  };

  it('redacts the API key echoed in a 500 body', async () => {
    const m = await errOf(fetcher(new Response(JSON.stringify({ error: { code: 'boom', message: `bad key ${KEY}` } }), { status: 500 })));
    expect(m).toMatch(/500/);
    expect(m).not.toContain(KEY);
  });

  it('redacts the API key echoed in a recipient_suppressed body', async () => {
    const m = await errOf(fetcher(new Response(JSON.stringify({ error: { code: 'recipient_suppressed', message: `x ${KEY} ${KEY}` } }), { status: 403 })));
    expect(m).toMatch(/suppress/i);
    expect(m).not.toContain(KEY);
  });

  it('throws a fixed message for a rejected fetch', async () => {
    const f = { fetch: vi.fn(async () => { throw new Error(`network down for ${KEY}`); }) } as never;
    const e = await new CfEmailSender(f, KEY, 'f@zhenhe-co.com').send(msg).then(() => null, (x: Error) => x);
    expect(e!.message).toBe('cf-email 呼叫失敗');
    expect((e as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});

describe('CfEmailSender 2xx body handling', () => {
  const KEY = 'sekrit-key-123';
  const run = (res: Response) => new CfEmailSender(fetcher(res), KEY, 'f@zhenhe-co.com').send(msg);
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

  it.each(['pending', 'sent'])('treats status %s as success and logs id and status only', async (status) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(json({ id: 'm-1', status }));
    expect(log).toHaveBeenCalledWith(`[email:cf-email] id=m-1 status=${status}`);
    const line = String(log.mock.calls[0][0]);
    expect(line).not.toContain(KEY);
    expect(line).not.toContain('a@example.com');
    log.mockRestore();
  });

  it('throws with the id when an idempotent replay returns status failed', async () => {
    await expect(run(json({ id: 'm-2', status: 'failed' }))).rejects.toThrow(/m-2.*failed/);
  });

  it('throws a recipient_suppressed-style error when status is suppressed', async () => {
    await expect(run(json({ id: 'm-3', status: 'suppressed' }))).rejects.toThrow(/recipient_suppressed/);
  });

  it('throws on a non-JSON 2xx body and redacts the key', async () => {
    const e = await run(new Response(`<html>${KEY}</html>`, { status: 200 })).then(() => null, (x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e!.message).not.toContain(KEY);
  });

  it('throws when a 2xx JSON body has no status', async () => {
    await expect(run(json({ id: 'm-4' }))).rejects.toThrow(/status/);
  });
});

describe('CfEmailSender escaped key and extra statuses', () => {
  const KEY = 'sekrit-key-123';
  const ESC = '\\u0073ekrit-key-123'; // JSON escape spelling the key
  const run = (res: Response) => new CfEmailSender(fetcher(res), KEY, 'f@zhenhe-co.com').send(msg);
  const raw = (b: string, status = 200) => new Response(b, { status });

  it('does not log a JSON-escaped key in the id', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(raw(`{"id":"${ESC}","status":"sent"}`));
    expect(log.mock.calls.flat().join('\n')).not.toContain(KEY);
    log.mockRestore();
  });

  it('does not throw a JSON-escaped key in a failed replay id', async () => {
    const e = await run(raw(`{"id":"${ESC}","status":"failed"}`)).then(() => null, (x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e!.message).not.toContain(KEY);
  });

  it('does not throw a JSON-escaped key from an error body', async () => {
    const e = await run(raw(`{"error":{"message":"${ESC}"}}`, 500)).then(() => null, (x: Error) => x);
    expect(e!.message).toMatch(/500/);
    expect(e!.message).not.toContain(KEY);
  });

  it('writes id=<invalid> for ids outside the allowed pattern', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(raw('{"id":"a b\\n<script>","status":"sent"}'));
    expect(log).toHaveBeenCalledWith('[email:cf-email] id=<invalid> status=sent');
    log.mockRestore();
    await expect(run(raw('{"id":"x y","status":"failed"}'))).rejects.toThrow(/id=<invalid>/);
  });

  it('treats delivered as success', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(raw('{"id":"m-5","status":"delivered"}'));
    expect(log).toHaveBeenCalledWith('[email:cf-email] id=m-5 status=delivered');
    log.mockRestore();
  });

  it.each(['bounced', 'complained'])('throws a clear error for %s', async (status) => {
    await expect(run(raw(`{"id":"m-6","status":"${status}"}`))).rejects.toThrow(new RegExp(`${status}.*(不會收到|will not)`));
  });

  it('still throws for an unknown status', async () => {
    await expect(run(raw('{"id":"m-7","status":"weird"}'))).rejects.toThrow(/status/);
    await expect(run(raw('{"id":"m-7","status":"weird"}'))).rejects.not.toThrow(/weird/);
  });
});

describe('CfEmailSender never echoes relay text', () => {
  const KEY = 'sekrit-key-123';
  const ESC = '\\u0073ekrit-key-123'; // JSON escape spelling the key
  const leaks = (t: string) => t.includes(KEY) || t.includes(ESC) || t.includes('sekrit');
  const run = (res: Response) => new CfEmailSender(fetcher(res), KEY, 'f@zhenhe-co.com').send(msg);
  const errOf = (res: Response) => run(res).then(() => { throw new Error('expected rejection'); }, (x: Error) => x.message);
  const raw = (b: string, status: number) => new Response(b, { status });

  it('fetch rejection with key and escaped key in the message', async () => {
    const f = { fetch: vi.fn(async () => { throw new Error(`down ${KEY} ${ESC}`); }) } as never;
    const m = await new CfEmailSender(f, KEY, 'f@zhenhe-co.com').send(msg).then(() => '', (x: Error) => x.message);
    expect(m).toBeTruthy();
    expect(leaks(m)).toBe(false);
  });

  it.each([200, 500])('non-JSON body (%i) containing key and escaped key', async (status) => {
    const m = await errOf(raw(`oops ${KEY} ${ESC}`, status));
    expect(m).toMatch(new RegExp(String(status)));
    expect(leaks(m)).toBe(false);
  });

  it('JSON error.message containing key, escaped key; error.code only if well-formed', async () => {
    const m = await errOf(raw(`{"error":{"code":"upstream_down","message":"${ESC} ${KEY}"}}`, 502));
    expect(m).toMatch(/502.*upstream_down/);
    expect(m).not.toMatch(/message/);
    expect(leaks(m)).toBe(false);
    const m2 = await errOf(raw(`{"error":{"code":"${ESC}","message":"x"}}`, 502));
    expect(m2).toMatch(/502/);
    expect(leaks(m2)).toBe(false);
  });

  it('escaped key as id on success, failed, suppressed and bounced', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(raw(`{"id":"${ESC}","status":"sent"}`, 200));
    expect(log).toHaveBeenCalledWith('[email:cf-email] id=<invalid> status=sent');
    expect(leaks(log.mock.calls.flat().join('\n'))).toBe(false);
    log.mockRestore();
    for (const st of ['failed', 'suppressed', 'bounced', 'complained']) {
      expect(leaks(await errOf(raw(`{"id":"${ESC}","status":"${st}"}`, 200)))).toBe(false);
    }
  });

  it('unknown status string is not echoed', async () => {
    expect(leaks(await errOf(raw(`{"id":"m-1","status":"${ESC}"}`, 200)))).toBe(false);
  });

  it('403 recipient_suppressed is still recognised from the parsed code', async () => {
    expect(await errOf(raw('{"error":{"code":"recipient_suppressed","message":"x"}}', 403))).toMatch(/recipient_suppressed/);
  });
});

describe('emailSenderFromEnv', () => {
  const binding = { fetch: vi.fn() } as never;
  it('defaults to cf-email when binding and key exist', () => {
    expect(emailSenderFromEnv({ CF_EMAIL: binding, CF_EMAIL_API_KEY: 'k' })).toBeInstanceOf(CfEmailSender);
  });
  it('defaults to console otherwise', () => {
    expect(emailSenderFromEnv({})).toBeInstanceOf(ConsoleEmailSender);
    expect(emailSenderFromEnv({ CF_EMAIL: binding })).toBeInstanceOf(ConsoleEmailSender);
  });
  it('explicit console wins', () => {
    expect(emailSenderFromEnv({ EMAIL_PROVIDER: 'console', CF_EMAIL: binding, CF_EMAIL_API_KEY: 'k' })).toBeInstanceOf(ConsoleEmailSender);
  });
  it('explicit cf-email without binding or key throws', () => {
    expect(() => emailSenderFromEnv({ EMAIL_PROVIDER: 'cf-email', CF_EMAIL_API_KEY: 'k' })).toThrow(/CF_EMAIL/);
    expect(() => emailSenderFromEnv({ EMAIL_PROVIDER: 'cf-email', CF_EMAIL: binding })).toThrow(/CF_EMAIL_API_KEY/);
  });
});
