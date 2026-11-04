import { useEffect, useState } from 'preact/hooks';
import { getAccount, type AccountState } from '../lib/account';

/** 帳號狀態；null = 載入中 */
export function useAccount(): [AccountState | null, () => void] {
  const [a, setA] = useState<AccountState | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    getAccount(n > 0).then((x) => { if (live) setA(x); });
    return () => { live = false; };
  }, [n]);
  return [a, () => setN((x) => x + 1)];
}
