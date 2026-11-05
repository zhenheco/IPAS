import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBankComplete, loadBank } from './bank';

/**
 * repo-root data/ (build runs from the repo root). Dev falls back to test fixtures when no question files exist;
 * a production build never falls back and fails loudly if the real data is missing.
 */
export function loadSiteBank() {
  // INCLUDE_OFFICIAL=1 is the owner's local self-study build only; CI builds are the ones that get deployed.
  if (process.env.INCLUDE_OFFICIAL === '1' && process.env.CI) throw new Error('INCLUDE_OFFICIAL=1 is not allowed in CI: official questions must not be built into a deployable site');
  const dev = import.meta.env.DEV;
  const bank = loadBank({
    dataDir: path.resolve(process.cwd(), 'data'),
    includeOfficial: process.env.INCLUDE_OFFICIAL === '1',
    fallbackDir: dev ? fileURLToPath(new URL('../test/fixtures/data', import.meta.url)) : undefined,
  });
  if (!dev) assertBankComplete(bank);
  return bank;
}
