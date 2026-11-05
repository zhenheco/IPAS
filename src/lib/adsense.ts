/** AdSense loader URL for the site-verification <head> tag; undefined (render nothing) when the client id is unset or blank. */
export function adsenseScriptSrc(client: string | undefined): string | undefined {
  const c = client?.trim();
  return c ? `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(c)}` : undefined;
}
