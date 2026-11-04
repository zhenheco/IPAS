import { useState } from 'preact/hooks';
import { safeNext } from '../lib/account';
import { PAYWALL_ENABLED } from '../lib/entitlement';

const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export default function Login() {
  const next = safeNext(new URLSearchParams(location.search).get('next'));
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  if (!PAYWALL_ENABLED) return <><h1>登入</h1><p class="notice">會員功能尚未開放，目前所有功能免登入即可使用，紀錄存在這台裝置的瀏覽器中。</p></>;

  async function google() {
    setState('sending');
    try {
      const r = await post('/api/auth/sign-in/social', { provider: 'google', callbackURL: next });
      const j = (await r.json()) as { url?: string };
      if (!r.ok || !j.url) throw new Error();
      location.href = j.url;
    } catch { setState('error'); }
  }
  async function magic(e: Event) {
    e.preventDefault();
    setState('sending');
    try {
      const r = await post('/api/auth/sign-in/magic-link', { email, callbackURL: next });
      setState(r.ok ? 'sent' : 'error');
    } catch { setState('error'); }
  }
  return (
    <>
      <h1>登入</h1>
      <div class="card">
        <button type="button" class="btn" onClick={google} disabled={state === 'sending'}>使用 Google 帳號登入</button>
      </div>
      <form class="card" onSubmit={magic}>
        <label class="field">以 Email 登入（寄送登入連結）
          <input type="email" required autocomplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            style="display:block;width:100%;margin-top:4px;font:inherit;padding:9px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--text);min-height:44px" />
        </label>
        <button type="submit" class="btn" disabled={state === 'sending' || !email}>寄送登入連結</button>
        {state === 'sent' && <p class="notice" role="status">已寄出登入連結到 {email}，請在 5 分鐘內點信中的連結。</p>}
      </form>
      {state === 'error' && <p class="notice warn" role="alert">登入失敗，請稍後再試。</p>}
      <p class="muted">登入後可購買考期通行證，並把這台裝置的作答歷史同步到帳號。</p>
    </>
  );
}
