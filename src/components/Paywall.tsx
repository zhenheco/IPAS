import type { ComponentChildren } from 'preact';
import { isEntitled } from '../lib/account';
import { FEATURE_NAME, PAYWALL_ENABLED, isPaidFeature, type Feature } from '../lib/entitlement';
import { PASS_LEVEL_NAME, type PassLevel } from '../lib/pricing';
import { useAccount } from './useAccount';

/**
 * 包住付費功能：paywall 關閉、免費功能或已持有該級別通行證時直接顯示內容；否則顯示鎖定與前往價目頁的按鈕。
 * 用法：<Paywall feature="exam" level="intermediate"><Setup … /></Paywall>
 */
export default function Paywall({ feature, level, children }: { feature: Feature; level: PassLevel; children: ComponentChildren }) {
  const [account] = useAccount();
  if (!PAYWALL_ENABLED || !isPaidFeature(feature)) return <>{children}</>;
  if (!account) return <p class="muted">載入中…</p>;
  if (isEntitled(account, level)) return <>{children}</>;
  return (
    <div class="card" role="region" aria-label="付費功能">
      <h2 style="margin-top:0">🔒 {FEATURE_NAME[feature]}需要{PASS_LEVEL_NAME[level]}考期通行證</h2>
      <p>考期通行證一次購買、涵蓋{PASS_LEVEL_NAME[level]}所有科目，有效至該梯次考試日後 30 天；免費會員仍可練習並保留作答歷史。</p>
      <div class="row">
        <a class="btn" href="/pricing/">查看價格</a>
        {account.status === 'anonymous' && <a class="btn ghost" href={`/login/?next=${encodeURIComponent(location.pathname + location.search)}`}>已購買？登入</a>}
      </div>
    </div>
  );
}
