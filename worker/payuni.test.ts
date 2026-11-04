import { describe, expect, it } from 'vitest';
import {
  UPP_ENDPOINT, buildCheckout, checkoutHtml, decryptInfo, encryptInfo, hashInfo, httpBuildQuery, newMerTradeNo, parseQuery,
  paymentOutcome, phpUrlencode, safeEqual, verifyPayuniForm, type PayuniConfig,
} from './payuni';

const KEY = '12345678901234567890123456789012';
const IV = 'abcdefghijklmnop';
const cfg: PayuniConfig = { merId: 'S01234567', hashKey: KEY, hashIV: IV, env: 'sandbox' };

/**
 * 以 PHP 8.3 執行「官方 PHP 範例寫法」(openssl_encrypt aes-256-gcm + bin2hex(cipher:::base64(tag)) 與
 * strtoupper(hash('sha256', key.encrypt.iv))) 產生的測試向量。證明本實作與該 PHP 寫法位元組一致；
 * 該寫法已對照官方 PHP SDK 與 API 文件確認（docs/research/payuni-upp-verification.md）。
 */
const PHP_PARAMS = {
  MerID: 'S01234567', MerTradeNo: 'IP261104120000ABC123', TradeAmt: 490, Timestamp: 1762228800,
  ProdDesc: 'iPAS 中級考期通行證 (2026-11-14) *~!', UsrMail: 'a+b@example.com', ReturnURL: 'https://ipas.zhenhe-co.com/api/payuni/return',
};
const PHP_QUERY = 'MerID=S01234567&MerTradeNo=IP261104120000ABC123&TradeAmt=490&Timestamp=1762228800&ProdDesc=iPAS+%E4%B8%AD%E7%B4%9A%E8%80%83%E6%9C%9F%E9%80%9A%E8%A1%8C%E8%AD%89+%282026-11-14%29+%2A%7E%21&UsrMail=a%2Bb%40example.com&ReturnURL=https%3A%2F%2Fipas.zhenhe-co.com%2Fapi%2Fpayuni%2Freturn';
const PHP_ENCRYPT = '6e5866445a476d56776f6a5567654f617347554667595a6744696a464975365535464b46395a6c684758503266694d77796271634633795a315038542f47444c437744575753726e6b4233355068473333706b4473644c7776353973624c5a426e6378546830694a3657775230505846305a4b68314c4b5933376559684e597338346330737555626d48656943436930776e3344643772686264417844325a79754f73515a48326976525a4e72706452634d4c5736474148797557424a426969584f327531356657327a72584334326349623277744c67304a69334345614a4b796c6c7844642b2f3977314462756446704f4e376147672f734d72302f702f722b6f344d6e675961732b3366344873736c4b6562736570774647744976544c424c6e5739486c3942494531577135684b5558587932537367742b6c4f53784579665a4a436e66422f675959345763307a6c597a473032524f67444d59384a644f69446f6a727538303843346e4374514e564d706b5a78383d3a3a3a5a716672506e5a57386e6a5948427557584f50724d413d3d';
const PHP_HASH = '5A779EBD6D6CB3714DF30CA722470C67B862D7BE278A0ABDD41B4F8073CAC0FA';

describe('http_build_query 相容', () => {
  it('matches PHP urlencode for reserved characters', () => {
    expect(phpUrlencode("a b*~!'()-_.")).toBe('a+b%2A%7E%21%27%28%29-_.');
    expect(httpBuildQuery(PHP_PARAMS)).toBe(PHP_QUERY);
  });
  it('parses + as space and percent escapes', () => {
    expect(parseQuery('A=a+b&B=%2B%E4%B8%AD')).toEqual({ A: 'a b', B: '+中' });
  });
});

describe('EncryptInfo / HashInfo', () => {
  it('produces byte-identical output to the PHP sample', async () => {
    expect(await encryptInfo(PHP_PARAMS, KEY, IV)).toBe(PHP_ENCRYPT);
    expect(await hashInfo(PHP_ENCRYPT, KEY, IV)).toBe(PHP_HASH);
  });
  it('decrypts the PHP vector', async () => {
    expect(await decryptInfo(PHP_ENCRYPT, KEY, IV)).toEqual(Object.fromEntries(Object.entries(PHP_PARAMS).map(([k, v]) => [k, String(v)])));
  });
  it('round-trips arbitrary params', async () => {
    const p = { A: '中文 & = ?', B: '', C: 0, D: 'x'.repeat(5000) };
    expect(await decryptInfo(await encryptInfo(p, KEY, IV), KEY, IV)).toEqual({ A: '中文 & = ?', B: '', C: '0', D: 'x'.repeat(5000) });
  });
  it('also accepts a JSON plaintext', async () => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(KEY), { name: 'AES-GCM' }, false, ['encrypt']);
    const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new TextEncoder().encode(IV) }, key, new TextEncoder().encode('{"MerID":"S1","TradeAmt":490,"X":null}')));
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    const hex = Array.from(new TextEncoder().encode(`${b64(out.slice(0, -16))}:::${b64(out.slice(-16))}`), (x) => x.toString(16).padStart(2, '0')).join('');
    expect(await decryptInfo(hex, KEY, IV)).toEqual({ MerID: 'S1', TradeAmt: '490', X: '' });
  });
  it('hash is uppercase hex sha256 of key+encrypt+iv', async () => {
    expect(await hashInfo('', KEY, IV)).toMatch(/^[0-9A-F]{64}$/);
    expect(await hashInfo('ab', KEY, IV)).not.toBe(await hashInfo('ac', KEY, IV));
  });
  it('trims keys like the PHP sample', async () => {
    expect(await encryptInfo(PHP_PARAMS, ` ${KEY}\n`, ` ${IV} `)).toBe(PHP_ENCRYPT);
  });
  it('rejects wrong key sizes', async () => {
    await expect(encryptInfo({}, 'short', IV)).rejects.toThrow(/32/);
    await expect(encryptInfo({}, KEY, 'short')).rejects.toThrow(/16/);
  });
  it('fails to decrypt tampered ciphertext or wrong key', async () => {
    const e = await encryptInfo({ A: '1' }, KEY, IV);
    const flipped = (e.slice(0, 4) === '4141' ? '4242' : '4141') + e.slice(4);
    await expect(decryptInfo(flipped, KEY, IV)).rejects.toThrow();
    await expect(decryptInfo(e, 'x'.repeat(32), IV)).rejects.toThrow();
    await expect(decryptInfo('zz', KEY, IV)).rejects.toThrow();
  });
  it('safeEqual', () => {
    expect(safeEqual('ABC', 'ABC')).toBe(true);
    expect(safeEqual('ABC', 'ABD')).toBe(false);
    expect(safeEqual('ABC', 'AB')).toBe(false);
  });
});

async function notifyForm(data: Record<string, string | number>, status = 'SUCCESS') {
  const EncryptInfo = await encryptInfo(data, KEY, IV);
  return { Status: status, MerID: String(data.MerID), Version: '2.0', EncryptInfo, HashInfo: await hashInfo(EncryptInfo, KEY, IV) };
}

describe('verifyPayuniForm', () => {
  const data = { Status: 'SUCCESS', MerID: 'S01234567', MerTradeNo: 'IP1', TradeNo: 'T1', TradeAmt: 490, TradeStatus: 1 };
  it('accepts a valid notify', async () => {
    const r = await verifyPayuniForm(cfg, await notifyForm(data));
    expect(r.ok && r.result).toMatchObject({ status: 'SUCCESS', merTradeNo: 'IP1', tradeNo: 'T1', tradeAmt: 490, tradeStatus: '1' });
  });
  it('rejects missing fields, bad hash, foreign merchant, bad payload', async () => {
    expect(await verifyPayuniForm(cfg, {})).toEqual({ ok: false, error: 'missing_fields' });
    const f = await notifyForm(data);
    expect(await verifyPayuniForm(cfg, { ...f, HashInfo: f.HashInfo.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) })).toEqual({ ok: false, error: 'bad_hash' });
    // 雜湊相符但密文不是有效 GCM（攻擊者知道金鑰才可能，仍須處理）
    const junk = '3a3a3a';
    expect(await verifyPayuniForm(cfg, { EncryptInfo: junk, HashInfo: await hashInfo(junk, KEY, IV) })).toEqual({ ok: false, error: 'decrypt_failed' });
    expect(await verifyPayuniForm(cfg, await notifyForm({ ...data, MerID: 'OTHER' }))).toEqual({ ok: false, error: 'mer_id_mismatch' });
    expect(await verifyPayuniForm(cfg, { ...f, MerID: 'OTHER' })).toEqual({ ok: false, error: 'mer_id_mismatch' });
    expect(await verifyPayuniForm(cfg, await notifyForm({ ...data, TradeAmt: '4.5' }))).toEqual({ ok: false, error: 'bad_payload' });
  });
  it('accepts lowercase HashInfo', async () => {
    const f = await notifyForm(data);
    expect((await verifyPayuniForm(cfg, { ...f, HashInfo: f.HashInfo.toLowerCase() })).ok).toBe(true);
  });
});

describe('paymentOutcome', () => {
  it('maps status codes', () => {
    expect(paymentOutcome({ status: 'SUCCESS', tradeStatus: '1' })).toBe('paid');
    expect(paymentOutcome({ status: 'SUCCESS', tradeStatus: '0' })).toBe('pending');
    expect(paymentOutcome({ status: 'SUCCESS', tradeStatus: '2' })).toBe('failed');
    expect(paymentOutcome({ status: 'SUCCESS', tradeStatus: '3' })).toBe('failed');
    expect(paymentOutcome({ status: 'ERROR', tradeStatus: '1' })).toBe('failed');
  });
  it('TradeStatus 8 (訂單待確認) stays pending', () => {
    expect(paymentOutcome({ status: 'SUCCESS', tradeStatus: '8' })).toBe('pending');
  });
  it('outer Status UNKNOWN (等待授權結果逾期/系統忙碌) and UNAPPROVED are pending, case-insensitively, and never paid', () => {
    for (const status of ['UNKNOWN', 'unknown', 'UNAPPROVED', 'Unapproved']) {
      for (const tradeStatus of ['', '0', '1', '8']) expect(paymentOutcome({ status, tradeStatus })).toBe('pending');
    }
  });
  it('an explicit failure (TradeStatus 2/3) is failed whatever the outer Status', () => {
    expect(paymentOutcome({ status: 'UNKNOWN', tradeStatus: '2' })).toBe('failed');
    expect(paymentOutcome({ status: 'UNAPPROVED', tradeStatus: '3' })).toBe('failed');
  });
});

describe('buildCheckout', () => {
  it('builds an encrypted UPP form for the configured environment', async () => {
    const now = new Date('2026-09-01T04:00:00Z');
    const f = await buildCheckout(cfg, { merTradeNo: 'IP1', amount: 490, prodDesc: '考期通行證', email: 'u@example.com' },
      { returnUrl: 'https://x/r', notifyUrl: 'https://x/n' }, now);
    expect(f.action).toBe(UPP_ENDPOINT.sandbox);
    expect(f.fields.MerID).toBe('S01234567');
    expect(f.fields.Version).toBe('2.0');
    expect(f.fields.HashInfo).toBe(await hashInfo(f.fields.EncryptInfo, KEY, IV));
    expect(await decryptInfo(f.fields.EncryptInfo, KEY, IV)).toEqual({
      MerID: 'S01234567', MerTradeNo: 'IP1', TradeAmt: '490', Timestamp: String(now.getTime() / 1000), ProdDesc: '考期通行證',
      UsrMail: 'u@example.com', ReturnURL: 'https://x/r', NotifyURL: 'https://x/n', TradeInvoice: '1',
    });
    const prod = await buildCheckout({ ...cfg, env: 'production' }, { merTradeNo: 'IP1', amount: 1, prodDesc: 'x', email: 'e' }, { returnUrl: 'r', notifyUrl: 'n' }, now);
    expect(prod.action).toBe('https://api.payuni.com.tw/api/upp');
  });
  it('renders an escaped auto-submit form', () => {
    const html = checkoutHtml({ action: 'https://a/upp', fields: { MerID: '"><script>', Version: '1.0', EncryptInfo: 'ab', HashInfo: 'CD' } });
    expect(html).toContain('action="https://a/upp"');
    expect(html).toContain('name="EncryptInfo" value="ab"');
    expect(html).not.toContain('"><script>');
    expect(html).toContain('.submit()');
  });
});

describe('newMerTradeNo', () => {
  it('is IP + Taipei timestamp + random, 20 chars', () => {
    expect(newMerTradeNo(new Date('2026-11-04T16:30:05Z'), () => 'abc123')).toBe('IP261105003005ABC123');
    expect(newMerTradeNo(new Date())).toMatch(/^IP\d{12}[0-9A-F]{6}$/);
  });
});
