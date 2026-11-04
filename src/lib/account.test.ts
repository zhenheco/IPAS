import { describe, expect, it } from 'vitest';
import { fetchAccount, isEntitled, reportPaidFeatureUse, safeNext, syncWithAccount, type AccountState, type Me } from './account';

const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const me: Me = {
  user: { id: 'u', email: 'e', name: 'n', image: null }, passes: [], orders: [],
  entitlements: { beginner: { paid: false, validUntil: null }, intermediate: { paid: true, validUntil: '2026-12-14T15:59:59.999Z' } },
};

describe('fetchAccount', () => {
  it('disabled without calling the API when the paywall flag is off', async () => {
    let called = false;
    expect(await fetchAccount(async () => { called = true; return jsonRes(200, me); }, false)).toEqual({ status: 'disabled' });
    expect(called).toBe(false);
  });
  it('signed-in / anonymous', async () => {
    expect(await fetchAccount(async () => jsonRes(200, me), true)).toEqual({ status: 'signed-in', me });
    expect(await fetchAccount(async () => jsonRes(401, { error: 'unauthenticated' }), true)).toEqual({ status: 'anonymous' });
  });
  it('falls back to disabled when offline, on 404 (static-only deploy), HTML or malformed JSON', async () => {
    expect(await fetchAccount(async () => { throw new TypeError('offline'); }, true)).toEqual({ status: 'disabled' });
    expect(await fetchAccount(async () => new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } }), true)).toEqual({ status: 'disabled' });
    expect(await fetchAccount(async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }), true)).toEqual({ status: 'disabled' });
    expect(await fetchAccount(async () => jsonRes(200, { nope: 1 }), true)).toEqual({ status: 'disabled' });
    expect(await fetchAccount(async () => jsonRes(500, {}), true)).toEqual({ status: 'disabled' });
  });
});

describe('isEntitled', () => {
  it('disabled means everything is open; otherwise per level', () => {
    expect(isEntitled({ status: 'disabled' }, 'beginner')).toBe(true);
    expect(isEntitled({ status: 'anonymous' }, 'intermediate')).toBe(false);
    expect(isEntitled({ status: 'signed-in', me }, 'intermediate')).toBe(true);
    expect(isEntitled({ status: 'signed-in', me }, 'beginner')).toBe(false);
    expect(isEntitled(null, 'beginner')).toBe(false);
  });
});

describe('syncWithAccount', () => {
  it('returns merged data or the server error message', async () => {
    const ok = await syncWithAccount({ sessions: [], questionStats: {} }, async () => jsonRes(200, { schemaVersion: 1, sessions: [], questionStats: {} }));
    expect(ok).toEqual({ ok: true, sessions: [], questionStats: {} });
    const bad = await syncWithAccount({ sessions: [], questionStats: {} }, async () => jsonRes(400, { error: 'bad_request', message: 'score 無效' }));
    expect(bad).toEqual({ ok: false, error: 'score 無效' });
    expect(await syncWithAccount({ sessions: [], questionStats: {} }, async () => { throw new Error(); })).toEqual({ ok: false, error: 'network' });
  });
});

describe('safeNext', () => {
  it('only allows same-site relative paths', () => {
    expect(safeNext('/pricing/')).toBe('/pricing/');
    expect(safeNext('//evil.com')).toBe('/account/');
    expect(safeNext('https://evil.com')).toBe('/account/');
    expect(safeNext('/\\evil.com')).toBe('/account/');
    expect(safeNext(null)).toBe('/account/');
  });
});

describe('reportPaidFeatureUse', () => {
  const signedIn = async (): Promise<AccountState> => ({ status: 'signed-in', me });
  const calls = () => { const c: { url: string; body: unknown }[] = []; const inits: (RequestInit | undefined)[] = []; return { c, inits, f: async (url: string, init?: RequestInit) => { inits.push(init); c.push({ url, body: JSON.parse(String(init?.body)) }); return jsonRes(200, { ok: true }); } }; };

  it('posts the 級別 and feature when the member holds a pass for that 級別', async () => {
    const { c, f } = calls();
    expect(await reportPaidFeatureUse('intermediate', 'exam', f, true, signedIn)).toBe(true);
    expect(c).toEqual([{ url: '/api/usage/paid-feature', body: { level: 'intermediate', feature: 'exam' } }]);
  });
  it('sends keepalive so the request survives the navigation to /session/ that follows a session start', async () => {
    const { inits, f } = calls();
    await reportPaidFeatureUse('intermediate', 'exam', f, true, signedIn);
    expect(inits[0]).toMatchObject({ method: 'POST', keepalive: true });
  });
  it('does nothing while the paywall is off, for anonymous users, for a 級別 without a pass, or for 無廣告 / free features / viewing-only features (錯題本, 弱點分析, 讀書計畫)', async () => {
    const { c, f } = calls();
    expect(await reportPaidFeatureUse('intermediate', 'weakness', f, false, signedIn)).toBe(false);
    expect(await reportPaidFeatureUse('intermediate', 'weakness', f, true, async () => ({ status: 'anonymous' }))).toBe(false);
    expect(await reportPaidFeatureUse('beginner', 'weakness', f, true, signedIn)).toBe(false);
    expect(await reportPaidFeatureUse('intermediate', 'noAds', f, true, signedIn)).toBe(false);
    expect(await reportPaidFeatureUse('intermediate', 'practice', f, true, signedIn)).toBe(false);
    for (const v of ['wrongbook', 'weakness', 'plan'] as const) expect(await reportPaidFeatureUse('intermediate', v, f, true, signedIn)).toBe(false);
    expect(c).toEqual([]);
  });
  it('returns false (and does not throw) when the request fails', async () => {
    expect(await reportPaidFeatureUse('intermediate', 'redo', async () => { throw new TypeError('offline'); }, true, signedIn)).toBe(false);
    expect(await reportPaidFeatureUse('intermediate', 'redo', async () => jsonRes(500, {}), true, signedIn)).toBe(false);
  });
});
