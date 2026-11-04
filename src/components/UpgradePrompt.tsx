import { useEffect, useState } from 'preact/hooks';
import { isEntitled } from '../lib/account';
import { PAYWALL_ENABLED, shouldShowUpgradePrompt } from '../lib/entitlement';
import { PASS_LEVEL_NAME, type PassLevel } from '../lib/pricing';
import { useAccount } from './useAccount';

const KEY = 'ipas.upgradePrompt.lastShownAt';

const readLast = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
const writeLast = (t: number) => { try { localStorage.setItem(KEY, String(t)); } catch { /* 每日一次僅為便利，存不了就算了 */ } };

/** 升級提醒：放在成績頁，對免費會員每日（台灣日曆日）至多顯示一次。 */
export default function UpgradePrompt({ level }: { level: PassLevel }) {
  const [account] = useAccount();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!PAYWALL_ENABLED || !account || account.status === 'disabled' || isEntitled(account, level)) return;
    const raw = readLast();
    const now = Date.now();
    if (shouldShowUpgradePrompt(raw === null ? null : Number(raw), now)) { setVisible(true); writeLast(now); }
  }, [account, level]);
  if (!visible) return null;
  return (
    <div class="notice" role="status">
      <span>想用計時模考、錯題本與弱點分析衝刺？購買{PASS_LEVEL_NAME[level]}考期通行證即可使用，且不顯示廣告。</span>
      <a class="btn small" href="/pricing/">查看價格</a>
      <button type="button" class="btn small ghost" onClick={() => setVisible(false)}>稍後再說</button>
    </div>
  );
}
