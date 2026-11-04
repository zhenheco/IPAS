import { useEffect, useRef } from 'preact/hooks';
import { PAYWALL_ENABLED, shouldShowAds } from '../lib/entitlement';
import type { PassLevel } from '../lib/pricing';
import { useAccount } from './useAccount';

const AD_CLIENT: string | undefined = import.meta.env.PUBLIC_ADSENSE_CLIENT;

declare global { interface Window { adsbygoogle?: unknown[] } }

function loadScript(client: string) {
  if (document.querySelector('script[data-adsbygoogle]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  s.crossOrigin = 'anonymous';
  s.dataset.adsbygoogle = '1';
  document.head.appendChild(s);
}

/**
 * 廣告版位：只有 PUBLIC_PAYWALL_ENABLED=1、設定了 PUBLIC_ADSENSE_CLIENT、且使用者不是付費會員時才顯示。
 * 帳號狀態載入前不顯示，避免付費會員看到閃現的廣告。
 */
export default function AdSlot({ slot, level }: { slot: string; level?: PassLevel }) {
  const [account] = useAccount();
  const ref = useRef<HTMLModElement>(null);
  const ent = account?.status === 'signed-in' ? account.me.entitlements : null;
  const show = !!account && account.status !== 'disabled' && shouldShowAds({ paywallEnabled: PAYWALL_ENABLED, adClient: AD_CLIENT, ent, level });
  useEffect(() => {
    if (!show || !AD_CLIENT || !ref.current) return;
    loadScript(AD_CLIENT);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* ad blockers */ }
  }, [show]);
  if (!show) return null;
  return (
    <aside class="adslot" aria-label="廣告" style="margin:16px 0;min-height:90px">
      <ins ref={ref} class="adsbygoogle" style="display:block" data-ad-client={AD_CLIENT} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
    </aside>
  );
}
