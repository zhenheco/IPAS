/**
 * 金流微服務 SDK
 *
 * 提供客戶端網站與金流微服務互動的介面。
 * 支援 sandbox（測試）和 production（正式）兩種環境。
 * 支援單次付款和定期定額付款。
 * USD 交易由 Zhenhe AI LLC 經 Stripe Checkout/Billing 收款；已 opt-in 的站台
 * 可用 TWD 建立 PAYUNi 月繳／年繳 mandate，或 TWD 一次性付款（不帶 periodParams，
 * 回傳 payuniForm，導向 PAYUNi UPP 整合式支付頁）。
 *
 * ## 安裝
 *
 * ```bash
 * npm install @affiliate/payment-sdk
 * # 或
 * yarn add @affiliate/payment-sdk
 * ```
 *
 * ## 初始化
 *
 * ```typescript
 * import { PaymentGatewayClient } from '@affiliate/payment-sdk';
 *
 * const client = new PaymentGatewayClient({
 *   apiKey: 'your-api-key',
 *   siteCode: 'YOUR_SITE',
 *   webhookSecret: 'your-webhook-secret',
 *   environment: 'sandbox', // 測試環境，正式環境改為 'production'
 * });
 * ```
 *
 * ## 單次付款
 *
 * ```typescript
 * const result = await client.createPayment({
 *   orderId: 'order-123',
 *   amount: 20.99, // USD major units (at most two decimals)
 *   currency: 'USD',
 *   description: '專業版訂閱',
 *   email: 'user@example.com',
 *   buyerCountry: 'US',
 *   buyerType: 'individual',
 * });
 *
 * // 導向 Stripe Checkout
 * window.location.assign(result.checkoutUrl!);
 * ```
 *
 * ## 定期定額付款
 *
 * USD 定期付款走 Stripe Billing；TWD 月繳／年繳只可由明確 opt-in 的站台建立 PAYUNi mandate。
 *
 * ```typescript
 * const result = await client.createPayment({
 *   orderId: 'subscription-123',
 *   amount: 20.99, // USD major units (at most two decimals)
 *   currency: 'USD',
 *   description: '月費方案',
 *   email: 'user@example.com',
 *   buyerCountry: 'US',
 *   buyerType: 'individual',
 *   periodParams: {
 *     periodType: 'M',      // 每月
 *     periodPoint: '01',    // 每月 1 號
 *     periodTimes: 12,      // 共 12 期
 *   },
 * });
 *
 * // 導向 Stripe Checkout
 * window.location.assign(result.checkoutUrl!);
 * ```
 *
 * TWD period enrollment 回傳 PAYUNi form，須在瀏覽器提交：
 *
 * ```typescript
 * const result = await client.createPayment({
 *   orderId: 'fly-monthly-123',
 *   amount: 990,
 *   currency: 'TWD',
 *   description: 'Monthly plan',
 *   email: 'user@example.com',
 *   buyerCountry: 'TW',
 *   buyerType: 'individual',
 *   periodParams: { periodType: 'M', periodPoint: '01', periodTimes: 12 },
 * });
 * submitPaymentForm(result.payuniForm);
 * ```
 *
 * ## TWD 一次性付款（PAYUNi UPP）
 *
 * 站台須由 Affiliate 明確啟用 `payuni_onetime_enabled`。TWD 且不帶 `periodParams`
 * 時回傳 `payuniForm`（`Version` 2.0），須在瀏覽器以 POST 提交至 `payuniForm.action`。
 * 載具／統編／捐贈碼由買方在 PAYUNi 頁面選擇，電子發票由 PAYUNi 商店後台設定的服務開立。
 * 付款結果以 HMAC webhook（`status` 為 SUCCESS／FAILED）為準；PAYUNi 取號未付款時不會送 webhook。
 * 退款目前**沒有**自動化：需由商店在 PAYUNi 後台手動退款，並手動作廢／折讓 PAYUNi 開立的發票，
 * 且不會有退款 webhook 通知站台。
 *
 * ```typescript
 * const result = await client.createPayment({
 *   orderId: 'ipas-season-123',
 *   amount: 199, // TWD 整數元
 *   currency: 'TWD',
 *   description: 'IPAS 考季通行證',
 *   email: 'user@example.com',
 *   buyerCountry: 'TW',
 *   buyerType: 'individual',
 * });
 * submitPaymentForm(result.payuniForm);
 * ```
 *
 * ## 驗證 Webhook
 *
 * ```typescript
 * const event = await client.parseWebhookEvent(rawBody, signature);
 * if (event.status === 'SUCCESS') {
 *   // 付款成功處理
 * }
 * ```
 *
 * ## Stripe Sandbox 測試
 *
 * Sandbox 環境使用 Stripe test mode；請使用 Stripe 官方測試卡號。
 */

// ========================================
// 類型定義
// ========================================

/**
 * 環境類型
 */
export type Environment = 'sandbox' | 'production';

/**
 * SDK 配置選項
 */
export interface PaymentGatewayConfig {
  /** API Key（從 Admin 後台取得） */
  apiKey: string;
  /** 網站代碼（從 Admin 後台取得） */
  siteCode: string;
  /** Webhook Secret（用於驗證回調簽名） */
  webhookSecret?: string;
  /** 環境（預設 production） */
  environment?: Environment;
  /** 自訂 Base URL（會覆寫環境設定） */
  baseUrl?: string;
  /** 請求超時時間（毫秒，預設 30000） */
  timeout?: number;
}

/**
 * 定期定額週期類型
 */
export type PeriodType = 'D' | 'W' | 'M' | 'Y';

/**
 * 訂閱參數（Stripe Billing 或 opted-in PAYUNi period 格式）
 */
export interface PeriodPaymentParams {
  /**
   * 週期類型
   * - D: 每日
   * - W: 每週
   * - M: 每月
   * - Y: 每年
   */
  periodType: PeriodType;
  /**
   * 扣款日期點（選填，若未提供則依首次扣款日自動計算）
   * - D/W: 1~7（星期一~日）
   * - M: 01~31（每月幾號）
   * - Y: MMDD（每年幾月幾號，如 0115）
   */
  periodPoint?: string;
  /** 授權期數（共幾期） */
  periodTimes: number;
  /** Stripe 首次扣款日（UTC YYYY-MM-DD 或 UTC ISO timestamp；PAYUNi TWD 不接受） */
  periodFirstdate?: string;
  /** @deprecated PAYUNi-only field; Stripe Billing ignores this value. */
  periodStartType?: 1 | 2 | 3;
}

/**
 * 發票輸入資訊
 */
export interface InvoiceInput {
  /** 買方名稱（預設用付款人姓名） */
  buyerName?: string;
  /** 發票 Email（預設用付款人 email） */
  buyerEmail?: string;
  /** 買方地址 */
  buyerAddress?: string;
  /** 買方電話 */
  buyerPhone?: string;
}

/**
 * 建立付款參數
 */
export interface CreatePaymentParams {
  /** 訂單 ID（必須唯一） */
  orderId: string;
  /** 付款金額（USD 最多兩位小數；PAYUNi TWD 必須為整數元） */
  amount: number;
  /**
   * TWD 僅限 Affiliate 明確 opt-in 的站台：
   * 帶 periodParams 為 PAYUNi 月繳／年繳（payuni_period_enabled），
   * 不帶 periodParams 為 PAYUNi UPP 一次性付款（payuni_onetime_enabled）。
   * 未 opt-in 的 TWD 請求由 broker 拒絕。
   */
  currency: 'USD' | 'TWD';
  /** 商品描述 */
  description: string;
  /** 付款人 Email */
  email: string;
  /** 付款人姓名 */
  payerName?: string;
  /** 付款人電話 */
  payerPhone?: string;
  /** 自訂回調 URL（覆寫網站配置） */
  callbackUrl?: string;
  /** 付款期限（分鐘，預設 60；broker 接受 35..1440，Stripe provider call 至少保留 30 分鐘） */
  expireMinutes?: number;
  /** 額外資料（會在 Webhook 中返回） */
  metadata?: Record<string, unknown>;
  /** 直接 web SaaS 稅務 gate 的買方國家（必須是 ISO 3166-1 alpha-2）。 */
  buyerCountry: string;
  /** 買方類型（必須明確提供）；TW individual 需通過 accountant verification gate。 */
  buyerType: 'individual' | 'business';
  /** Same-site stable identity used for Stripe Customer reuse. */
  clientUserRef?: string;
  /** Explicit legacy PAYUNi subscription being reauthorized to Stripe. */
  migrationFromSubscriptionId?: string;
  /** 定期定額參數；TWD 只支援 M/Y 且須提供有效 periodPoint。 */
  periodParams?: PeriodPaymentParams;
  /** 發票 profile；Stripe invoice/receipt 負責寄送，不會觸發 Amego ISSUE。 */
  invoice?: InvoiceInput;
}

const ISO_ALPHA2_CODES: ReadonlySet<string> = new Set(`
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM
JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP
MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN
TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/));

function isIsoAlpha2CountryCode(value: unknown): value is string {
  return typeof value === "string" &&
    ISO_ALPHA2_CODES.has(value.trim().toUpperCase());
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function assertPeriodFirstdate(value: string): void {
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const utcDateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(trimmed);
  const parts = dateOnly ?? utcDateTime;
  if (!parts) throw new PaymentGatewayError("periodFirstdate 必須是 UTC ISO 日期", "VALIDATION_ERROR");
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = utcDateTime ? Number(parts[4]) : 0;
  const minute = utcDateTime ? Number(parts[5]) : 0;
  const second = utcDateTime ? Number(parts[6]) : 0;
  const milliseconds = utcDateTime ? Number((parts[7] ?? "").padEnd(3, "0") || 0) : 0;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59 || milliseconds > 999) {
    throw new PaymentGatewayError("periodFirstdate 必須是有效的 UTC ISO 日期", "VALIDATION_ERROR");
  }
  const parsed = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const date = new Date(parsed);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second || date.getUTCMilliseconds() !== milliseconds) {
    throw new PaymentGatewayError("periodFirstdate 必須是有效的 UTC ISO 日期", "VALIDATION_ERROR");
  }
  const now = Date.now();
  if (
    parsed < now + 48 * 60 * 60 * 1000 ||
    parsed > now + 730 * 24 * 60 * 60 * 1000
  ) {
    throw new PaymentGatewayError(
      "periodFirstdate 必須介於現在起 48 小時至 730 天內",
      "VALIDATION_ERROR",
    );
  }
}

/**
 * 付款結果
 */
export interface PaymentResult {
  /** 是否成功 */
  success: boolean;
  /** 付款 ID */
  paymentId: string;
  /** Stripe Checkout 導頁 URL（一次性付款） */
  checkoutUrl?: string;
  /** @deprecated 僅保留既有 PAYUNi 站台相容；新交易使用 checkoutUrl。 */
  paymentForm?: {
    /** 表單提交網址 */
    action: string;
    /** HTTP 方法 */
    method: 'POST';
    /**
     * 表單欄位
     * - MerID: 商店編號
     * - Version: API 版本（period 為 1.0；UPP 一次性付款為 2.0）
     * - EncryptInfo: 加密資料
     * - HashInfo: 簽名
     */
    fields: Record<string, string>;
  };
  /**
   * opt-in PAYUNi/TWD 的表單：月繳／年繳提交至 PAYUNi period Page；
   * 一次性付款（無 periodParams）提交至 PAYUNi UPP（Version 2.0）。
   */
  payuniForm?: PaymentResult['paymentForm'];
  /** 是否為定期定額付款 */
  isPeriodPayment?: boolean;
  /** 錯誤訊息 */
  error?: string;
}

/**
 * 付款狀態
 */
export type PaymentStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED';

/**
 * 續期 / 訂閱 webhook 類型
 */
export type ForwardSiteWebhookType =
  | 'RECURRING'
  | 'REFUND'
  | 'SUBSCRIPTION_TRIALING'
  | 'SUBSCRIPTION_PAST_DUE'
  | 'SUBSCRIPTION_UPDATED'
  | 'SUBSCRIPTION_CANCELED';

/**
 * 付款狀態查詢結果
 */
export interface PaymentStatusResult {
  /** 付款 ID */
  paymentId: string;
  /** 訂單 ID */
  orderId: string;
  /** 付款狀態 */
  status: PaymentStatus;
  /** 金額 */
  amount: number;
  /** 付款幣別（USD 或 opted-in PAYUNi TWD） */
  currency?: string;
  /** 付款時間（ISO 8601） */
  paidAt?: string;
  /** 金流服務商交易序號 */
  tradeNo?: string;
  /** 金流服務商名稱 */
  provider?: string;
  /** 金流服務商訂單編號（PAYUNi MerTradeNo） */
  providerOrderNo?: string;
  /** 錯誤代碼 */
  errorCode?: string;
  /** 錯誤訊息 */
  errorMessage?: string;
  /** 額外資料 */
  metadata?: Record<string, unknown>;
  /** 建立時間 */
  createdAt?: string;
}

/** Exact request body bytes used for webhook signing and verification. */
export type RawWebhookBody = string | Uint8Array;

/**
 * Webhook 事件
 */
interface WebhookEventBase {
  /** 續期 / 訂閱事件類型 */
  type?: Exclude<ForwardSiteWebhookType, 'SUBSCRIPTION_TRIALING'>;
  /** forward_site 契約版本 */
  contractVersion?: string;
  /** 付款 ID */
  paymentId?: string;
  /** 訂單 ID */
  orderId: string;
  /** 付款狀態 */
  status?: PaymentStatus;
  /** 續期 / 訂閱事件 ID */
  eventId?: string;
  /** 金流發生時間（ISO 8601） */
  gatewayOccurredAt?: string;
  /** client 站台代碼 */
  siteCode?: string;
  /** Site-scoped client identity used for Stripe Customer mapping. */
  clientUserRef?: string;
  /** Stripe Customer evidence for portal and reconciliation. */
  stripeCustomerId?: string;
  /** 金流服務商訂單 / 訂閱序號 */
  providerOrderNo?: string;
  /** 續期第幾期 */
  chargeSequence?: number;
  /** forward_site nonce */
  nonce?: string;
  /** forward_site 轉發時間 */
  forwardedAt?: string;
  /** 金額 */
  amount?: number;
  /** 付款時間 */
  paidAt?: string;
  /** 金流服務商交易序號 */
  tradeNo?: string;
  /** 付款方式 */
  paymentType?: string;
  /** 額外資料 */
  metadata?: Record<string, unknown>;
  /** 錯誤訊息（當 status 為 FAILED 時） */
  errorMessage?: string;
  /** 金流服務商 */
  provider?: string;
  /** 付款幣別；PAYUNi/TWD 首扣、一次性付款與 recurring event 使用 TWD。 */
  currency?: string;
  /** Stripe 是 invoice/receipt sender。 */
  receiptSender?: 'stripe' | string;
  /** 付款 provider evidence 的來源；Odoo lifecycle 仍以 Odoo 為業務 SoR。 */
  paymentSourceOfTruth?: 'stripe' | string;
  /** Stripe subscription id */
  stripeSubscriptionId?: string;
  /** Trial start/end are required by the SUBSCRIPTION_TRIALING contract. */
  trialStart?: string;
  trialEnd?: string;
  /** Stripe invoice id */
  stripeInvoiceId?: string;
  /** Stripe payment_intent id */
  paymentIntentId?: string;
  /** Stripe subscription.status */
  subscriptionStatus?: string;
  /** Stripe subscription.cancel_at_period_end */
  cancelAtPeriodEnd?: boolean;
  /** Stripe current_period_end */
  currentPeriodEnd?: string;
  /** Stripe canceled_at */
  canceledAt?: string;
  /** Stripe ended_at */
  endedAt?: string;
  /** Invoice amount due in USD major units (Stripe minor units converted exactly) */
  amountDue?: number;
  /** Invoice amount remaining in USD major units (Stripe minor units converted exactly) */
  amountRemaining?: number;
  /** Stripe invoice attempt_count */
  attemptCount?: number;
  /** Stripe invoice next_payment_attempt */
  nextPaymentAttempt?: string;
  /** Stripe subscription item / price summary */
  subscriptionItems?: Array<Record<string, unknown>>;
  /** 信用卡指紋（SHA-256，同一張卡 = 同一個值） */
  cardFingerprint?: string;
  /** 信用卡後 4 碼（供 UI 顯示） */
  cardLast4?: string;
  /** 歷史 Amego 發票資訊；新 Stripe 回調改用 receipt evidence。 */
  invoice?: {
    /** 發票號碼 */
    invoiceNumber?: string;
    /** 發票隨機碼 */
    randomNumber?: string;
    /** 發票日期 */
    invoiceDate?: string;
    /** 發票狀態 */
    status?: string;
    /** 錯誤訊息 */
    errorMessage?: string;
  };
  /** Stripe receipt/invoice evidence，供 client archive/reconciliation。 */
  receipt?: {
    provider: 'stripe';
    paymentIntentId?: string;
    chargeId?: string;
    stripeInvoiceId?: string;
    receiptUrl?: string;
  };
  /** Stripe refund evidence；client 只應歸檔/對帳，不應再次寄送 receipt。 */
  refund?: {
    provider: 'stripe';
    refundId: string;
    amount: number;
    cumulativeRefundedAmount?: number;
    paymentIntentId?: string;
    chargeId: string;
    stripeInvoiceId?: string;
  };
  /** PAYUNi migration evidence; clients must retain and reconcile it. */
  migrationReview?: {
    required: true;
    reason: string;
    mandateCreatedAt?: string;
    reauthorizedToStripeAt?: string | null;
  };
}

/** Trial callbacks are a discriminated contract: entitlement ends at trialEnd. */
export interface SubscriptionTrialWebhookEvent extends Omit<
  WebhookEventBase,
  'type' | 'stripeSubscriptionId' | 'trialStart' | 'trialEnd'
> {
  type: 'SUBSCRIPTION_TRIALING';
  stripeSubscriptionId: string;
  trialStart: string;
  trialEnd: string;
}

export type WebhookEvent = WebhookEventBase | SubscriptionTrialWebhookEvent;

// ========================================
// 錯誤類別
// ========================================

/**
 * 金流 SDK 錯誤
 */
export class PaymentGatewayError extends Error {
  /** 錯誤代碼 */
  readonly code: string;
  /** HTTP 狀態碼 */
  readonly statusCode?: number;
  /** 原始錯誤 */
  readonly cause?: Error;

  constructor(
    message: string,
    code: string,
    options?: { statusCode?: number; cause?: Error }
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
    this.code = code;
    this.statusCode = options?.statusCode;
    this.cause = options?.cause;
  }
}

// ========================================
// 預設配置
// ========================================

const DEFAULT_URLS = {
  sandbox: 'https://sandbox.affiliate.1wayseo.com',
  production: 'https://affiliate.1wayseo.com',
} as const;

const DEFAULT_TIMEOUT = 30000;

// ========================================
// SDK 實作
// ========================================

/**
 * 金流微服務客戶端
 *
 * 提供與金流微服務互動的方法，包括：
 * - 建立付款請求
 * - 查詢付款狀態
 * - 驗證 Webhook 簽名
 */
export class PaymentGatewayClient {
  private readonly config: Required<
    Omit<PaymentGatewayConfig, 'webhookSecret'>
  > & { webhookSecret?: string };

  constructor(config: PaymentGatewayConfig) {
    // 驗證必填參數
    if (!config.apiKey?.trim()) {
      throw new PaymentGatewayError(
        'apiKey 是必填參數',
        'MISSING_API_KEY'
      );
    }

    if (!config.siteCode?.trim()) {
      throw new PaymentGatewayError(
        'siteCode 是必填參數',
        'MISSING_SITE_CODE'
      );
    }

    const environment = config.environment || 'production';

    this.config = {
      apiKey: config.apiKey.trim(),
      siteCode: config.siteCode.trim().toUpperCase(),
      webhookSecret: config.webhookSecret?.trim(),
      environment,
      baseUrl: config.baseUrl?.trim() || DEFAULT_URLS[environment],
      timeout: config.timeout || DEFAULT_TIMEOUT,
    };
  }

  // ========================================
  // 公開方法 - 配置資訊
  // ========================================

  /**
   * 取得當前環境
   */
  getEnvironment(): Environment {
    return this.config.environment;
  }

  /**
   * 取得 Base URL
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  // ========================================
  // 公開方法 - 付款操作
  // ========================================

  /**
   * 建立付款請求
   *
   * @param params 付款參數
   * @returns 付款結果（新交易包含 Stripe Checkout URL）
   *
   * @example
   * ```typescript
   * const result = await client.createPayment({
   *   orderId: 'ORDER-2025-001',
   *   amount: 20.99, // USD major units (at most two decimals)
   *   currency: 'USD',
   *   description: '專業版訂閱',
   *   email: 'user@example.com',
   *   buyerCountry: 'US',
   *   buyerType: 'individual',
   * });
   *
   * if (result.checkoutUrl) {
   *   window.location.assign(result.checkoutUrl);
   * }
   * ```
   */
  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    // 驗證參數
    this.validateCreatePaymentParams(params);

    const url = `${this.config.baseUrl}/api/payment/create`;

    try {
      const response = await this.fetch(url, {
        method: 'POST',
        body: JSON.stringify({
          ...params,
          siteCode: this.config.siteCode,
        }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new PaymentGatewayError(
          error.error || '建立付款失敗',
          'CREATE_PAYMENT_FAILED',
          { statusCode: response.status }
        );
      }

      const result = (await response.json()) as PaymentResult & {
        payuniForm?: PaymentResult['paymentForm'];
      };

      // Keep the deprecated paymentForm alias available for older SDK consumers.
      if (result.payuniForm && !result.paymentForm) {
        result.paymentForm = result.payuniForm;
      }

      return result;
    } catch (error) {
      if (error instanceof PaymentGatewayError) {
        throw error;
      }
      throw new PaymentGatewayError(
        '網路請求失敗',
        'NETWORK_ERROR',
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * 查詢付款狀態
   *
   * @param paymentId 付款 ID
   * @returns 付款狀態
   */
  async getPaymentStatus(paymentId: string): Promise<PaymentStatusResult> {
    if (!paymentId?.trim()) {
      throw new PaymentGatewayError(
        'paymentId 是必填參數',
        'MISSING_PAYMENT_ID'
      );
    }

    const url = `${this.config.baseUrl}/api/payment/${encodeURIComponent(paymentId)}`;

    try {
      const response = await this.fetch(url, { method: 'GET' });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new PaymentGatewayError(
          error.error || '查詢付款狀態失敗',
          'GET_PAYMENT_STATUS_FAILED',
          { statusCode: response.status }
        );
      }

      return (await response.json()) as PaymentStatusResult;
    } catch (error) {
      if (error instanceof PaymentGatewayError) {
        throw error;
      }
      throw new PaymentGatewayError(
        '網路請求失敗',
        'NETWORK_ERROR',
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  // ========================================
  // 公開方法 - Webhook 處理
  // ========================================

  /**
   * 生成 HMAC-SHA256 簽名。呼叫者必須傳入實際送出的 raw body bytes，
   * 不可傳 parsed object 讓 SDK 重新序列化。
   *
   * @param rawBody 實際 HTTP request body（字串或 UTF-8 bytes）
   * @returns 十六進位簽名字串
   */
  async generateSignature(rawBody: RawWebhookBody): Promise<string> {
    if (!this.config.webhookSecret) {
      throw new PaymentGatewayError(
        'webhookSecret 未設定，無法生成簽名',
        'MISSING_WEBHOOK_SECRET'
      );
    }

    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.config.webhookSecret);
    const messageData: BufferSource = typeof rawBody === 'string'
      ? encoder.encode(rawBody)
      : rawBody as unknown as BufferSource;

    // 使用 Web Crypto API（相容 Cloudflare Workers）
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);

    // 轉換為十六進位字串
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * 驗證 Webhook 簽名
   *
   * @param rawBody 實際收到的 HTTP request body（字串或 UTF-8 bytes）
   * @param signature 請求中的簽名
   * @returns 是否有效
   */
  async verifyWebhookSignature(
    rawBody: RawWebhookBody,
    signature: string
  ): Promise<boolean> {
    if (!this.config.webhookSecret) {
      throw new PaymentGatewayError(
        'webhookSecret 未設定，無法驗證簽名',
        'MISSING_WEBHOOK_SECRET'
      );
    }

    try {
      const expectedSignature = await this.generateSignature(rawBody);
      return this.timingSafeEqual(expectedSignature, signature);
    } catch {
      return false;
    }
  }

  /**
   * 解析並驗證 Webhook 事件
   *
   * @param rawBody 原始請求 body（JSON 字串）
   * @param signature 請求中的簽名（從 X-Webhook-Signature header 取得）
   * @returns 驗證後的 Webhook 事件
   *
   * @example
   * ```typescript
   * // 在 API route 中
   * export async function POST(request: Request) {
   *   const rawBody = await request.text();
   *   const signature = request.headers.get('X-Webhook-Signature');
   *
   *   try {
   *     const event = await client.parseWebhookEvent(rawBody, signature);
   *
   *     switch (event.status) {
   *       case 'SUCCESS':
   *         await handlePaymentSuccess(event);
   *         break;
   *       case 'FAILED':
   *         await handlePaymentFailed(event);
   *         break;
   *     }
   *
   *     return new Response('OK', { status: 200 });
   *   } catch (error) {
   *     return new Response('Unauthorized', { status: 401 });
   *   }
   * }
   * ```
   */
  async parseWebhookEvent(
    rawBody: RawWebhookBody,
    signature: string | null
  ): Promise<WebhookEvent> {
    if (!signature) {
      throw new PaymentGatewayError(
        '缺少 Webhook 簽名',
        'MISSING_SIGNATURE'
      );
    }

    const rawText = typeof rawBody === 'string'
      ? rawBody
      : new TextDecoder().decode(rawBody);
    let payload: WebhookEvent;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new PaymentGatewayError(
        '無效的 JSON 格式',
        'INVALID_JSON'
      );
    }

    const isValid = await this.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      throw new PaymentGatewayError(
        'Webhook 簽名驗證失敗',
        'INVALID_SIGNATURE'
      );
    }

    return payload;
  }

  // ========================================
  // 靜態工具方法
  // ========================================

  /**
   * 格式化金額（加上千分位和幣別）
   */
  static formatAmount(amount: number, currency = 'USD'): string {
    const normalizedCurrency = currency.toUpperCase();
    const symbol = normalizedCurrency === 'USD'
      ? '$'
      : normalizedCurrency === 'TWD'
        ? 'NT$'
        : normalizedCurrency;
    return `${symbol}${amount.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  }

  /**
   * 驗證訂單 ID 格式
   */
  static isValidOrderId(orderId: string): boolean {
    if (!orderId || orderId.length > 50) {
      return false;
    }
    // 只允許英文、數字、連字號（符合 PAYUNi 規範）
    return /^[a-zA-Z0-9-]+$/.test(orderId);
  }

  /**
   * 驗證 Email 格式
   */
  static isValidEmail(email: string): boolean {
    if (!email) {
      return false;
    }
    // 基本 Email 格式驗證
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // ========================================
  // 私有方法
  // ========================================

  /**
   * 驗證建立付款參數
   */
  private validateCreatePaymentParams(params: CreatePaymentParams): void {
    if (!params.orderId?.trim()) {
      throw new PaymentGatewayError(
        'orderId 是必填參數',
        'VALIDATION_ERROR'
      );
    }

    if (!PaymentGatewayClient.isValidOrderId(params.orderId)) {
      throw new PaymentGatewayError(
        'orderId 格式無效（只允許英文、數字、連字號，最長 50 字元）',
        'VALIDATION_ERROR'
      );
    }

    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new PaymentGatewayError(
        'amount 必須是正數',
        'VALIDATION_ERROR'
      );
    }

    const minorAmount = Math.round(params.amount * 100);
    if (params.currency === 'TWD' && !Number.isInteger(params.amount)) {
      throw new PaymentGatewayError(
        'PAYUNi TWD amount 必須是整數元',
        'INVALID_AMOUNT',
      );
    }
    if (params.currency === 'USD' && Math.abs(params.amount * 100 - minorAmount) > 1e-8) {
      throw new PaymentGatewayError(
        'amount 最多只能有兩位小數',
        'VALIDATION_ERROR',
      );
    }

    if (params.currency !== 'USD' && params.currency !== 'TWD') {
      throw new PaymentGatewayError(
        'currency 必須明確指定 USD；TWD 僅供 opted-in PAYUNi 站台使用',
        'UNSUPPORTED_CURRENCY',
      );
    }

    if (!isIsoAlpha2CountryCode(params.buyerCountry)) {
      throw new PaymentGatewayError(
        'buyerCountry 必須是已驗證的 ISO 3166-1 alpha-2 國家碼',
        'BUYER_IDENTITY_REQUIRED',
      );
    }

    if (params.buyerType !== 'individual' && params.buyerType !== 'business') {
      throw new PaymentGatewayError(
        'buyerType 必須明確指定為 individual 或 business',
        'BUYER_IDENTITY_REQUIRED',
      );
    }

    if (params.clientUserRef !== undefined &&
      (!params.clientUserRef.trim() || params.clientUserRef.trim().length > 200)) {
      throw new PaymentGatewayError(
        'clientUserRef 必須是 1-200 字元',
        'VALIDATION_ERROR',
      );
    }

    if (params.migrationFromSubscriptionId !== undefined &&
      (!params.migrationFromSubscriptionId.trim() || params.migrationFromSubscriptionId.trim().length > 200)) {
      throw new PaymentGatewayError(
        'migrationFromSubscriptionId 必須是 1-200 字元',
        'VALIDATION_ERROR',
      );
    }

    if (
      params.expireMinutes !== undefined &&
      (!Number.isInteger(params.expireMinutes) ||
        params.expireMinutes < 35 ||
        params.expireMinutes > 1440)
    ) {
      throw new PaymentGatewayError(
        'expireMinutes 必須是 35-1440 的整數',
        'VALIDATION_ERROR',
      );
    }

    const legacyInvoiceFields = params.invoice as
      | (InvoiceInput & { carrierType?: unknown; carrierId?: unknown; buyerTaxId?: unknown })
      | undefined;
    if (legacyInvoiceFields?.carrierType || legacyInvoiceFields?.carrierId ||
      (legacyInvoiceFields && Object.prototype.hasOwnProperty.call(legacyInvoiceFields, 'buyerTaxId'))) {
      throw new PaymentGatewayError(
        'Stripe web sales use native tax_id_collection; Taiwan carrier, donation, and global tax-id fields are not accepted',
        'UNSUPPORTED_INVOICE_FIELD',
      );
    }

    if (!params.description?.trim()) {
      throw new PaymentGatewayError(
        'description 是必填參數',
        'VALIDATION_ERROR'
      );
    }

    if (!PaymentGatewayClient.isValidEmail(params.email)) {
      throw new PaymentGatewayError(
        'email 格式無效',
        'VALIDATION_ERROR'
      );
    }

    // 驗證定期定額參數
    if (params.periodParams) {
      this.validatePeriodParams(params.periodParams, params.currency === 'TWD');
    }
  }

  /**
   * 驗證定期定額參數
   */
  private validatePeriodParams(
    params: PeriodPaymentParams,
    isPayuniPeriod = false,
  ): void {
    const validPeriodTypes = ['D', 'W', 'M', 'Y'];
    if (!validPeriodTypes.includes(params.periodType)) {
      throw new PaymentGatewayError(
        'periodType 必須是 D（天）、W（週）、M（月）或 Y（年）',
        'VALIDATION_ERROR'
      );
    }

    if (isPayuniPeriod && params.periodType !== 'M' && params.periodType !== 'Y') {
      throw new PaymentGatewayError(
        'PAYUNi TWD 只支援月繳（M）或年繳（Y）',
        'PAYUNI_PERIOD_TYPE_UNSUPPORTED',
      );
    }
    if (isPayuniPeriod && !params.periodPoint?.trim()) {
      throw new PaymentGatewayError(
        'PAYUNi TWD 必須提供 periodPoint',
        'INVALID_PAYUNI_PERIOD_POINT',
      );
    }
    if (isPayuniPeriod && (params.periodFirstdate || params.periodStartType !== undefined)) {
      throw new PaymentGatewayError(
        'PAYUNi TWD 首次扣款固定立即執行，不接受自訂首扣日期或類型',
        'PAYUNI_PERIOD_START_OVERRIDE_UNSUPPORTED',
      );
    }

    // 驗證週期點（若有提供）
    if (params.periodPoint?.trim()) {
      switch (params.periodType) {
        case 'D':
        case 'W': {
          if (!/^\d{1,2}$/.test(params.periodPoint)) {
            throw new PaymentGatewayError(
              'W（週）或 D（天）週期的 periodPoint 必須是 1~7（1=週一）',
              'VALIDATION_ERROR'
            );
          }
          const weekday = Number(params.periodPoint);
          if (weekday < 1 || weekday > 7) {
            throw new PaymentGatewayError(
              'W（週）或 D（天）週期的 periodPoint 必須是 1~7（1=週一）',
              'VALIDATION_ERROR'
            );
          }
          break;
        }
        case 'M': {
          if (isPayuniPeriod && !/^\d{2}$/.test(params.periodPoint)) {
            throw new PaymentGatewayError(
              'PAYUNi 月繳 periodPoint 必須是 01~28',
              'INVALID_PAYUNI_PERIOD_POINT',
            );
          }
          if (!/^\d{1,2}$/.test(params.periodPoint)) {
            throw new PaymentGatewayError(
              'M（月）週期的 periodPoint 必須是 01~31',
              'VALIDATION_ERROR'
            );
          }
          const day = Number(params.periodPoint);
          if (day < 1 || day > (isPayuniPeriod ? 28 : 31)) {
            throw new PaymentGatewayError(
              isPayuniPeriod
                ? 'PAYUNi 月繳 periodPoint 必須是 01~28'
                : 'M（月）週期的 periodPoint 必須是 01~31',
              isPayuniPeriod ? 'INVALID_PAYUNI_PERIOD_POINT' : 'VALIDATION_ERROR'
            );
          }
          break;
        }
        case 'Y': {
          if (!/^\d{4}$/.test(params.periodPoint)) {
            throw new PaymentGatewayError(
              'Y（年）週期的 periodPoint 必須是 MMDD 格式（如 0115 表示 1 月 15 日）',
              'VALIDATION_ERROR'
            );
          }
          const month = Number(params.periodPoint.substring(0, 2));
          const day = Number(params.periodPoint.substring(2, 4));
          if (month < 1 || month > 12 || day < 1 || day > daysInMonth(2000, month)) {
            throw new PaymentGatewayError(
              'Y（年）週期的 periodPoint MMDD 格式無效',
              'VALIDATION_ERROR'
            );
          }
          break;
        }
      }
    } else if (!params.periodFirstdate?.trim()) {
      // 若無 periodPoint 也無 periodFirstdate，報錯（除非後端會自動補，但前端最好報錯）
      // 不過為了向下相容，這裡暫不強求，交由後端處理
    }

    if (params.periodFirstdate?.trim()) {
      assertPeriodFirstdate(params.periodFirstdate);
    }

    if (
      !Number.isInteger(params.periodTimes) ||
      params.periodTimes < 1 ||
      params.periodTimes > (isPayuniPeriod ? 900 : 120)
    ) {
      throw new PaymentGatewayError(
        isPayuniPeriod
          ? 'PAYUNi periodTimes 必須是 1-900 的正整數'
          : 'periodTimes 必須是 1-120 的正整數',
        isPayuniPeriod ? 'INVALID_PAYUNI_PERIOD_TIMES' : 'VALIDATION_ERROR'
      );
    }

    if (
      params.periodStartType !== undefined &&
      ![1, 2, 3].includes(params.periodStartType)
    ) {
      throw new PaymentGatewayError(
        'periodStartType 必須是 1、2 或 3',
        'VALIDATION_ERROR'
      );
    }
  }

  /**
   * 封裝 fetch，加入通用 headers
   */
  private async fetch(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeout
    );

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'X-Site-Code': this.config.siteCode,
          ...options.headers,
        },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 時間安全的字串比較（防止 timing attack）
   */
  private timingSafeEqual(a: string, b: string): boolean {
    const length = Math.max(a.length, b.length);
    let result = a.length ^ b.length;
    for (let i = 0; i < length; i++) {
      result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return result === 0;
  }
}

// ========================================
// 便利函數
// ========================================

/**
 * 建立 SDK 實例的工廠函數
 *
 * @example
 * ```typescript
 * // 從環境變數建立 SDK
 * const client = createPaymentGatewayClient({
 *   apiKey: process.env.PAYMENT_API_KEY!,
 *   siteCode: process.env.PAYMENT_SITE_CODE!,
 *   webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET,
 *   environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
 * });
 * ```
 */
export function createPaymentGatewayClient(
  config: PaymentGatewayConfig
): PaymentGatewayClient {
  return new PaymentGatewayClient(config);
}

/**
 * 提交金流表單（瀏覽器端使用）
 *
 * TWD 月繳／年繳只限明確 opt-in 站台；Stripe 付款應導向 checkoutUrl。
 *
 * @param formData PAYUNi period form 或相容 paymentForm 資料
 * @throws 如果 formData 無效或不在瀏覽器環境中
 *
 * @example
 * ```typescript
 * const result = await client.createPayment({
 *   orderId: 'order-123',
 *   amount: 20, // historical one-time PAYUNi shape; new TWD periods use createPayment
 *   description: '專業版訂閱',
 *   email: 'user@example.com',
 * });
 *
 * if (result.paymentForm) {
 *   submitPaymentForm(result.paymentForm);
 *   // 用於 opt-in PAYUNi period enrollment；paymentForm 仍是相容別名
 * }
 * ```
 */
export function submitPaymentForm(
  formData: PaymentResult['paymentForm']
): void {
  if (!formData) {
    throw new PaymentGatewayError(
      '表單資料無效',
      'INVALID_FORM_DATA'
    );
  }

  if (typeof document === 'undefined') {
    throw new PaymentGatewayError(
      '此函數只能在瀏覽器環境中使用',
      'BROWSER_ONLY'
    );
  }

  const form = document.createElement('form');
  form.method = formData.method;
  form.action = formData.action;
  form.style.display = 'none';

  for (const [key, value] of Object.entries(formData.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

/**
 * 提交金流表單（舊版名稱，向下相容）
 * @deprecated 請使用 submitPaymentForm
 */
export const submitNewebpayForm = submitPaymentForm;

/**
 * 取得歷史 PAYUNi 測試卡號（新交易請使用 Stripe test mode）
 *
 * @returns 歷史相容測試卡號資訊
 */
export function getTestCardNumbers(): {
  success: { cardNumber: string; description: string };
  failure: { cardNumber: string; description: string };
} {
  return {
    success: {
      cardNumber: '4000-2211-1111-1111',
      description: '歷史 PAYUNi 相容測試卡號；新交易請使用 Stripe test mode',
    },
    failure: {
      cardNumber: '4000-2211-1111-1112',
      description: '歷史 PAYUNi 相容失敗卡號；新交易請使用 Stripe test mode',
    },
  };
}
