/**
 * PAYUNi（統一金流）UPP 整合支付頁串接。商店：振禾有限公司（統編 83446730）。
 *
 * 加解密依 PAYUNi 官方 PHP 範例的理解實作（撰寫時無法連線官方文件驗證）：
 *   EncryptInfo = bin2hex( openssl_encrypt(http_build_query(params), 'aes-256-gcm', HashKey, 0, HashIV, $tag)
 *                          . ':::' . base64_encode($tag) )
 *   （openssl_encrypt 的 options=0 時輸出即為 base64 密文）
 *   HashInfo    = strtoupper( hash('sha256', HashKey . EncryptInfo . HashIV) )
 * 以 WebCrypto（crypto.subtle）實作，Workers 與 Node 皆可執行。
 *
 * 所有未經官方文件確認的假設都標註「待以 PAYUNi 官方文件確認」，並整理在 docs/payments.md。
 */

export type PayuniEnv = 'sandbox' | 'production';

export interface PayuniConfig {
  merId: string;
  /** 32 字元（AES-256 金鑰） */
  hashKey: string;
  /** 16 字元（GCM IV） */
  hashIV: string;
  env: PayuniEnv;
}

// 待以 PAYUNi 官方文件確認：UPP 端點網址
export const UPP_ENDPOINT: Record<PayuniEnv, string> = {
  sandbox: 'https://sandbox-api.payuni.com.tw/api/upp',
  production: 'https://api.payuni.com.tw/api/upp',
};

// 待以 PAYUNi 官方文件確認：UPP 的 Version 參數值
export const UPP_VERSION = '1.0';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** PHP urlencode()：空白轉 +，僅保留英數與 -_. 不編碼（與 http_build_query 預設 PHP_QUERY_RFC1738 相同） */
export const phpUrlencode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+');

/** PHP http_build_query() 的一維版本；鍵順序依插入順序 */
export const httpBuildQuery = (params: Record<string, string | number>) =>
  Object.entries(params).map(([k, v]) => `${phpUrlencode(k)}=${phpUrlencode(String(v))}`).join('&');

/** PHP parse_str() 的一維版本（+ 視為空白） */
export const parseQuery = (q: string): Record<string, string> => Object.fromEntries(new URLSearchParams(q));

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('EncryptInfo 不是有效的十六進位字串');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const toB64 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const TAG_BYTES = 16;

/** 官方範例對金鑰與 IV 先 trim() 再使用（HashInfo 則用未 trim 的原值） */
function keyBytes(hashKey: string, hashIV: string) {
  // 待以 PAYUNi 官方文件確認：HashKey 為 32 字元、HashIV 為 16 字元，直接以 UTF-8 位元組作為金鑰與 IV
  const key = enc.encode(hashKey.trim());
  const iv = enc.encode(hashIV.trim());
  if (key.length !== 32) throw new Error('PAYUNI_HASH_KEY 必須為 32 位元組');
  if (iv.length !== 16) throw new Error('PAYUNI_HASH_IV 必須為 16 位元組');
  return { key, iv };
}

const importKey = (key: Uint8Array, usage: KeyUsage) =>
  crypto.subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, [usage]);

export async function encryptInfo(params: Record<string, string | number>, hashKey: string, hashIV: string): Promise<string> {
  const k = keyBytes(hashKey, hashIV);
  const key = await importKey(k.key, 'encrypt');
  // WebCrypto 的 AES-GCM 輸出為「密文 || 16 位元組 tag」
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: k.iv as BufferSource, tagLength: TAG_BYTES * 8 }, key, enc.encode(httpBuildQuery(params))));
  const cipher = out.slice(0, out.length - TAG_BYTES);
  const tag = out.slice(out.length - TAG_BYTES);
  return toHex(enc.encode(`${toB64(cipher)}:::${toB64(tag)}`));
}

export async function decryptInfo(encryptInfoHex: string, hashKey: string, hashIV: string): Promise<Record<string, string>> {
  const k = keyBytes(hashKey, hashIV);
  const [c64, t64, ...rest] = dec.decode(fromHex(encryptInfoHex.trim())).split(':::');
  if (!c64 || !t64 || rest.length) throw new Error('EncryptInfo 格式錯誤');
  const cipher = fromB64(c64);
  const tag = fromB64(t64);
  if (tag.length !== TAG_BYTES) throw new Error('GCM tag 長度錯誤');
  const joined = new Uint8Array(cipher.length + tag.length);
  joined.set(cipher);
  joined.set(tag, cipher.length);
  const key = await importKey(k.key, 'decrypt');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: k.iv as BufferSource, tagLength: TAG_BYTES * 8 }, key, joined);
  return parsePlain(dec.decode(plain));
}

/**
 * 解密後內容：官方 PHP 範例以 parse_str 解析 query string；
 * 第三方 payuni-sdk-ts（改寫自官方 .NET SDK）另會先嘗試 JSON。兩者都支援，值一律轉為字串。
 */
function parsePlain(s: string): Record<string, string> {
  const t = s.trim();
  if (t.startsWith('{')) {
    const o = JSON.parse(t) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)]));
  }
  return parseQuery(t);
}

export async function hashInfo(encryptInfoHex: string, hashKey: string, hashIV: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(hashKey + encryptInfoHex + hashIV));
  return toHex(new Uint8Array(d)).toUpperCase();
}

/** 長度相同時逐字元比較，避免時序側通道 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export interface CheckoutOrder {
  merTradeNo: string;
  amount: number;
  prodDesc: string;
  email: string;
}

export interface CheckoutForm {
  action: string;
  fields: { MerID: string; Version: string; EncryptInfo: string; HashInfo: string };
}

/** 產生送往 UPP 的表單欄位 */
export async function buildCheckout(cfg: PayuniConfig, order: CheckoutOrder, urls: { returnUrl: string; notifyUrl: string; backUrl?: string }, now: Date): Promise<CheckoutForm> {
  // 待以 PAYUNi 官方文件確認：UPP 加密參數名稱與必填項目（MerID、MerTradeNo、TradeAmt、Timestamp、ProdDesc、UsrMail、ReturnURL、NotifyURL、BackURL）
  const params: Record<string, string | number> = {
    MerID: cfg.merId,
    MerTradeNo: order.merTradeNo,
    TradeAmt: order.amount,
    Timestamp: Math.floor(now.getTime() / 1000),
    ProdDesc: order.prodDesc,
    UsrMail: order.email,
    ReturnURL: urls.returnUrl,
    NotifyURL: urls.notifyUrl,
  };
  if (urls.backUrl) params.BackURL = urls.backUrl;
  const EncryptInfo = await encryptInfo(params, cfg.hashKey, cfg.hashIV);
  const HashInfo = await hashInfo(EncryptInfo, cfg.hashKey, cfg.hashIV);
  return { action: UPP_ENDPOINT[cfg.env], fields: { MerID: cfg.merId, Version: UPP_VERSION, EncryptInfo, HashInfo } };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 自動送出的 HTML 表單（瀏覽器以 POST 前往 PAYUNi） */
export function checkoutHtml(f: CheckoutForm): string {
  const inputs = Object.entries(f.fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>前往付款</title></head>
<body><form id="payuni" method="post" action="${esc(f.action)}">${inputs}<p>正在前往 PAYUNi 付款頁…</p><noscript><button type="submit">前往付款</button></noscript></form>
<script>document.getElementById('payuni').submit()</script></body></html>`;
}

export interface PayuniResult {
  /** 外層 Status（未加密） */
  status: string;
  merId: string;
  merTradeNo: string;
  tradeNo: string;
  tradeAmt: number;
  tradeStatus: string;
  /** 解密後全部欄位 */
  data: Record<string, string>;
  /** 解密後原始 query string，供對帳保存 */
  raw: string;
}

export type VerifyError = 'missing_fields' | 'bad_hash' | 'decrypt_failed' | 'mer_id_mismatch' | 'bad_payload';

/**
 * 驗證並解密 NotifyURL / ReturnURL 收到的表單。
 * 順序：欄位齊全 → HashInfo 相符 → 解密成功 → 內外層 MerID 皆等於本商店。
 */
export async function verifyPayuniForm(cfg: PayuniConfig, form: Record<string, string>): Promise<{ ok: true; result: PayuniResult } | { ok: false; error: VerifyError }> {
  // 待以 PAYUNi 官方文件確認：回傳表單欄位為 Status、MerID、Version、EncryptInfo、HashInfo
  const { EncryptInfo, HashInfo } = form;
  if (!EncryptInfo || !HashInfo) return { ok: false, error: 'missing_fields' };
  const expected = await hashInfo(EncryptInfo, cfg.hashKey, cfg.hashIV);
  if (!safeEqual(expected, HashInfo.toUpperCase())) return { ok: false, error: 'bad_hash' };
  let data: Record<string, string>;
  try { data = await decryptInfo(EncryptInfo, cfg.hashKey, cfg.hashIV); } catch { return { ok: false, error: 'decrypt_failed' }; }
  if ((form.MerID && form.MerID !== cfg.merId) || data.MerID !== cfg.merId) return { ok: false, error: 'mer_id_mismatch' };
  // 待以 PAYUNi 官方文件確認：解密後欄位名稱 MerTradeNo、TradeNo、TradeAmt、TradeStatus、Status
  const tradeAmt = Number(data.TradeAmt);
  if (!data.MerTradeNo || !Number.isInteger(tradeAmt)) return { ok: false, error: 'bad_payload' };
  return {
    ok: true,
    result: {
      status: form.Status ?? data.Status ?? '',
      merId: data.MerID,
      merTradeNo: data.MerTradeNo,
      tradeNo: data.TradeNo ?? '',
      tradeAmt,
      tradeStatus: data.TradeStatus ?? '',
      data,
      raw: httpBuildQuery(data),
    },
  };
}

export type PaymentOutcome = 'paid' | 'failed' | 'pending';

/**
 * 依回傳判斷付款結果。
 * 待以 PAYUNi 官方文件確認：Status=SUCCESS 且 TradeStatus=1 為已付款；TradeStatus 2/3 為失敗/取消；
 * 其餘（如 0 = ATM/超商已取號未付款）視為仍待付款。
 */
export function paymentOutcome(r: Pick<PayuniResult, 'status' | 'tradeStatus'>): PaymentOutcome {
  if (r.status === 'SUCCESS' && r.tradeStatus === '1') return 'paid';
  if (r.status !== 'SUCCESS' || r.tradeStatus === '2' || r.tradeStatus === '3') return 'failed';
  return 'pending';
}

/**
 * 商店訂單編號：IP + 台灣時間 yyMMddHHmmss + 6 碼隨機英數（共 20 字元）。
 * 待以 PAYUNi 官方文件確認：MerTradeNo 長度上限與允許字元（假設 ≤ 25 字元英數）。
 */
export function newMerTradeNo(now: Date, rand: () => string = () => crypto.randomUUID().replace(/-/g, '').slice(0, 6)): string {
  const t = new Date(now.getTime() + 8 * 3_600_000).toISOString();
  const stamp = t.slice(2, 4) + t.slice(5, 7) + t.slice(8, 10) + t.slice(11, 13) + t.slice(14, 16) + t.slice(17, 19);
  return `IP${stamp}${rand().toUpperCase()}`;
}
