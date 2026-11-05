/** AdSense responsive display ad unit IDs (created in the AdSense console); the only place they live. */
export const AD_UNITS = { home: '8140139966', session: '1669713341', result: '3461307163' } as const;
export type AdUnit = keyof typeof AD_UNITS;
