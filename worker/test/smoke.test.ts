import { expect, it } from 'vitest';
import { harness } from './harness';
it('signs in with magic link and reads /api/me', async () => {
  const h = harness();
  const cookie = await h.signIn('a@example.com');
  const r = await h.client(cookie).get('/api/me');
  console.log(r.status, await r.clone().text());
  expect(r.status).toBe(200);
});
