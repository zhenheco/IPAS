import { describe, expect, it } from 'vitest';
import { adsenseScriptSrc } from './adsense';

describe('adsenseScriptSrc', () => {
  it('builds the AdSense loader url with the client URL-encoded', () => {
    expect(adsenseScriptSrc('ca-pub-2083860552590797')).toBe('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2083860552590797');
    expect(adsenseScriptSrc('a&b=c')).toBe('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=a%26b%3Dc');
  });
  it('is undefined when the client is unset or blank, so no tag renders', () => {
    expect(adsenseScriptSrc(undefined)).toBeUndefined();
    expect(adsenseScriptSrc('')).toBeUndefined();
    expect(adsenseScriptSrc('  ')).toBeUndefined();
  });
});
