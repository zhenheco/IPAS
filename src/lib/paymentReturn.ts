/**
 * 付款完成後瀏覽器被帶回 /account/?paymentId=…&orderId=…&status=success|failed|pending 時顯示的提示。
 * 權益只由 webhook 開通：success 只有在網址的 orderId（即本站 merchant_trade_no）對應到登入者「該筆」已付款訂單，
 * 且該訂單名下有未撤銷的通行證時才說「已開通」（持有其他梯次或已撤銷的通行證不算）；不信任網址參數。
 */
export interface PaymentNotice { text: string; warn: boolean }

export function paymentNotice(
  search: string,
  orders: { id: string; merchantTradeNo: string; status: string }[],
  passes: { orderId: string; revokedAt: string | null }[],
): PaymentNotice | null {
  const q = new URLSearchParams(search);
  switch (q.get('status')) {
    case 'success': {
      const order = orders.find((o) => o.merchantTradeNo === q.get('orderId') && o.status === 'paid');
      return order && passes.some((p) => p.orderId === order.id && !p.revokedAt)
        ? { warn: false, text: '付款成功，考期通行證已開通。' }
        : { warn: true, text: '已收到付款結果，正在確認；確認後考期通行證會自動開通，請稍後重新整理本頁。' };
    }
    case 'pending':
      return { warn: true, text: '已收到付款資訊，入帳後會自動開通（ATM／超商付款可能需要一些時間）。' };
    case 'failed':
      return { warn: true, text: '付款未完成，可回到價格頁重新購買。' };
    default:
      return null;
  }
}
