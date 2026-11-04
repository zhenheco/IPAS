import { useState } from 'preact/hooks';
import { requestRefund, signOut, syncWithAccount, type Me } from '../lib/account';
import { PAYWALL_ENABLED } from '../lib/entitlement';
import { PASS_LEVEL_NAME, PASS_LEVELS, PRICE_TYPE_NAME, REFUND_BLOCK_TEXT } from '../lib/pricing';
import { useApp } from './app';
import { useAccount } from './useAccount';

const fmt = (iso: string) => new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });

const PAYMENT_TEXT: Record<string, string> = {
  paid: '付款成功，考期通行證已開通。',
  pending: '已收到付款資訊，入帳後會自動開通（ATM／超商付款可能需要一些時間）。',
  failed: '付款未完成，可回到價格頁重新購買。',
  error: '付款結果驗證失敗；若已扣款，請來信並附上訂單時間。',
};
const STATUS_TEXT: Record<Me['orders'][number]['status'], string> = { pending: '待付款', paid: '已付款', failed: '付款失敗', refunded: '已退款' };

function SyncCard() {
  const { state, update } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!state) return;
    setBusy(true);
    const r = await syncWithAccount({ sessions: state.sessions, questionStats: state.questionStats });
    if (r.ok) {
      await update((s) => ({ ...s, sessions: r.sessions, questionStats: r.questionStats }));
      setMsg(`同步完成：共 ${r.sessions.length} 筆作答歷史。`);
    } else setMsg(`同步失敗：${r.error === 'network' ? '網路連線錯誤' : r.error}`);
    setBusy(false);
  }
  return (
    <div class="card">
      <h3>同步作答紀錄</h3>
      <p class="muted">把這台裝置的作答歷史與錯題統計合併到帳號，再把合併結果存回這台裝置。換裝置前後各同步一次可避免遺漏。</p>
      <button type="button" class="btn" onClick={run} disabled={busy || !state}>立即同步</button>
      {msg && <p class="notice" role="status">{msg}</p>}
    </div>
  );
}

function Orders({ me, onChange }: { me: Me; onChange: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function refund(id: string) {
    const reason = prompt('退款原因（選填）') ?? '';
    if (!confirm('確定申請全額退款？退款完成後考期通行證將停用。')) return;
    const r = await requestRefund(id, reason);
    setMsg(r.ok ? '已送出退款申請，我們會在數個工作天內處理。' : `無法申請退款：${REFUND_BLOCK_TEXT[r.error as keyof typeof REFUND_BLOCK_TEXT] ?? r.error}`);
    onChange();
  }
  if (me.orders.length === 0) return <p class="muted">尚無訂單。</p>;
  return (
    <>
      {msg && <p class="notice" role="status">{msg}</p>}
      <div class="tablewrap">
        <table>
          <thead><tr><th>日期</th><th>項目</th><th>金額</th><th>狀態</th><th></th></tr></thead>
          <tbody>
            {me.orders.map((o) => (
              <tr key={o.id}>
                <td>{fmt(o.paidAt ?? o.createdAt)}</td>
                <td>{PASS_LEVEL_NAME[o.level]}考期通行證 <span class="muted">{o.sittingId}</span></td>
                <td>NT${o.amount} <span class="muted">{PRICE_TYPE_NAME[o.priceType]}</span></td>
                <td>{o.refundRequestedAt && o.status === 'paid' ? '退款處理中' : STATUS_TEXT[o.status]}</td>
                <td>{o.refund.eligible ? <button type="button" class="btn small ghost" onClick={() => refund(o.id)}>申請退款</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="muted">退款規則：購買後 7 天內、且未使用任何付費功能可全額退款。</p>
    </>
  );
}

export default function Account() {
  const [account, reload] = useAccount();
  const payment = new URLSearchParams(location.search).get('payment');
  if (!PAYWALL_ENABLED || account?.status === 'disabled') {
    return <><h1>帳號</h1><p class="notice">會員功能尚未開放，目前所有功能免登入即可使用。</p></>;
  }
  if (!account) return <p class="muted">載入中…</p>;
  if (account.status === 'anonymous') {
    return <><h1>帳號</h1>{payment && <p class="notice">{PAYMENT_TEXT[payment] ?? ''} 請登入查看。</p>}<p>尚未登入。</p><a class="btn" href="/login/?next=/account/">登入</a></>;
  }
  const { me } = account;
  return (
    <>
      <h1>帳號</h1>
      {payment && PAYMENT_TEXT[payment] && <p class={`notice${payment === 'paid' ? '' : ' warn'}`} role="status">{PAYMENT_TEXT[payment]}</p>}
      <div class="card">
        <p><strong>{me.user.name || me.user.email}</strong> <span class="muted">{me.user.email}</span></p>
        <div class="row">
          <button type="button" class="btn small ghost" onClick={async () => { await signOut(); location.href = '/'; }}>登出</button>
        </div>
      </div>
      <h2>考期通行證</h2>
      <div class="grid">
        {PASS_LEVELS.slice().reverse().map((l) => {
          const e = me.entitlements[l];
          return (
            <div class="card" key={l}>
              <h3>{PASS_LEVEL_NAME[l]}</h3>
              {e.paid && e.validUntil ? <p><span class="badge ok">付費會員</span> 有效至 {fmtDay(e.validUntil)}</p> : <p><span class="badge bad">免費會員</span> <a href="/pricing/">購買考期通行證</a></p>}
            </div>
          );
        })}
      </div>
      <SyncCard />
      <h2>訂單</h2>
      <Orders me={me} onChange={reload} />
    </>
  );
}
