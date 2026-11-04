import { useEffect, useState } from 'preact/hooks';
import { PAYWALL_ENABLED } from '../lib/entitlement';
import { PASS_LEVEL_NAME, PRICE_TYPE_NAME, PRICING, PASS_LEVELS, type PassLevel, type PriceType } from '../lib/pricing';

interface Offer {
  id: string; level: PassLevel; name: string; examDate: string; purchasable: boolean; owned: boolean;
  quote: { priceType: PriceType; amount: number; applicable: { priceType: PriceType; amount: number }[] }; validUntil: string;
}

const ERRORS: Record<string, string> = {
  consent_required: '請先勾選同意數位內容立即提供、不適用 7 天鑑賞期。',
  already_owned: '你已持有此梯次的考期通行證。',
  not_purchasable: '此梯次已停止販售。',
  sitting_not_found: '找不到此梯次。',
  payment_unavailable: '付款服務暫時無法使用，請稍後再試。',
  bad_origin: '請從本站頁面送出購買。',
};

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });

function PriceTable() {
  return (
    <div class="tablewrap">
      <table>
        <thead><tr><th>級別</th><th>定價</th><th>早鳥價</th><th>續購價</th></tr></thead>
        <tbody>
          {PASS_LEVELS.slice().reverse().map((l) => (
            <tr key={l}><td>{PASS_LEVEL_NAME[l]}</td><td>NT${PRICING.prices[l].regular}</td><td>NT${PRICING.prices[l].early}</td><td>NT${PRICING.prices[l].renewal}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rules() {
  return (
    <ul class="rules">
      <li>考期通行證：一次付款，涵蓋該級別所有科目、單一梯次，自購買起至考試日後 {PRICING.validDaysAfterExam} 天止。初級與中級分開購買。</li>
      <li>早鳥價：考試日前 {PRICING.earlyBirdDays} 天（含）以上購買。續購價：曾購買過考期通行證者。多項適用時取最低價。</li>
      <li>付費功能：單科模考、全真模考、錯題本、錯題重做、弱點分析、讀書計畫，且不顯示廣告。練習與作答歷史永遠免費。</li>
      <li>退款：購買後 {PRICING.refundWindowDays} 天內、且尚未使用任何付費功能，可全額退款。</li>
      <li>收款與發票：振禾有限公司（統編 83446730）透過 PAYUNi 收款，自動開立電子發票。</li>
    </ul>
  );
}

export default function Pricing() {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [failed, setFailed] = useState(false);
  const error = new URLSearchParams(location.search).get('error');

  useEffect(() => {
    if (!PAYWALL_ENABLED) return;
    fetch('/api/pricing', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { sittings: Offer[]; signedIn: boolean }) => { setOffers(j.sittings); setSignedIn(j.signedIn); }, () => setFailed(true));
  }, []);

  if (!PAYWALL_ENABLED || failed) {
    return (
      <>
        <h1>價格</h1>
        <p class="notice">{PAYWALL_ENABLED ? '暫時無法取得梯次資訊，請稍後再試。' : '付費方案尚未開放，目前所有功能皆可免費使用。'}</p>
        <PriceTable />
        <Rules />
      </>
    );
  }
  return (
    <>
      <h1>考期通行證</h1>
      {error && <p class="notice warn" role="alert">{ERRORS[error] ?? '購買失敗，請稍後再試。'}</p>}
      {!offers ? <p class="muted">載入中…</p> : offers.length === 0 ? <p class="notice">目前沒有開放販售的梯次。</p> : (
        <div class="grid">
          {offers.map((o) => (
            <form class="card" key={o.id} method="post" action="/api/checkout">
              <h3>{PASS_LEVEL_NAME[o.level]} · {o.name}</h3>
              <p class="muted">考試日 {o.examDate}，有效至 {fmtDay(o.validUntil)}</p>
              <p class="big">NT${o.quote.amount} <span class="badge ok">{PRICE_TYPE_NAME[o.quote.priceType]}</span></p>
              <input type="hidden" name="sittingId" value={o.id} />
              {o.owned ? <p class="notice">已持有，<a href="/account/">查看帳號</a></p> : !signedIn ? (
                <a class="btn" href="/login/?next=/pricing/">登入後購買</a>
              ) : (
                <>
                  <label class="check">
                    <input type="checkbox" name="consent" value="on" required />
                    <span>我同意本數位內容於付款後立即提供，因此不適用 7 天鑑賞期（解除權）；退款依本站退款規則辦理。</span>
                  </label>
                  <button type="submit" class="btn" disabled={!o.purchasable}>前往付款</button>
                </>
              )}
            </form>
          ))}
        </div>
      )}
      <h2>說明</h2>
      <PriceTable />
      <Rules />
    </>
  );
}
