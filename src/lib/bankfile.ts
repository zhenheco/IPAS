import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBankComplete, loadBank } from './bank';

/**
 * repo-root data/ (build runs from the repo root). Dev falls back to test fixtures when no question files exist;
 * a production build never falls back and fails loudly if the real data is missing.
 */
export function loadSiteBank() {
  const dev = import.meta.env.DEV;
  const bank = loadBank({
    dataDir: path.resolve(process.cwd(), 'data'),
    includeOfficial: process.env.INCLUDE_OFFICIAL === '1',
    fallbackDir: dev ? fileURLToPath(new URL('../test/fixtures/data', import.meta.url)) : undefined,
  });
  if (!dev) assertBankComplete(bank);
  return bank;
}
