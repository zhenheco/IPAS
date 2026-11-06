import { useRef, useState } from 'preact/hooks';

type State = 'idle' | 'sending' | 'sent' | 'error' | 'limited';

/** 浮動「聯絡我們」按鈕：打開小表單，送到 /api/contact 由站方寄信給站長。 */
export function Contact() {
  const dlg = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>('idle');

  async function submit(e: Event) {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    setState('sending');
    try {
      const r = await fetch('/api/contact', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: f.get('email'), message: f.get('message'), website: f.get('website'), page: location.pathname }),
      });
      setState(r.ok ? 'sent' : r.status === 429 ? 'limited' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <>
      <button type="button" class="btn contact-fab" onClick={() => { setState('idle'); dlg.current?.showModal(); }}>聯絡我們</button>
      <dialog ref={dlg} class="contact-dlg" aria-labelledby="contact-title">
        {state === 'sent' ? (
          <div>
            <h2 id="contact-title">已送出</h2>
            <p>謝謝你的訊息，我們會盡快回信。</p>
            <button type="button" class="btn" onClick={() => dlg.current?.close()}>關閉</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 id="contact-title">聯絡我們</h2>
            <label class="field">你的 Email<input name="email" type="email" required maxLength={200} autocomplete="email" /></label>
            <label class="field">訊息<textarea name="message" required maxLength={2000} rows={5} /></label>
            {/* honeypot：真人看不到 */}
            <input name="website" tabIndex={-1} autocomplete="off" class="hp" aria-hidden="true" />
            {state === 'error' ? <p class="err" role="alert">送出失敗，請稍後再試，或直接寫信到 ace@zhenheai.com。</p> : null}
            {state === 'limited' ? <p class="err" role="alert">送出太頻繁，請一分鐘後再試。</p> : null}
            <div class="row">
              <button type="button" class="btn ghost" onClick={() => dlg.current?.close()}>取消</button>
              <button class="btn" disabled={state === 'sending'}>{state === 'sending' ? '送出中…' : '送出'}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
