const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL"]);

/** 單筆成交總額（現金類＝金額；證券＝數量×價格） */
export function getTransactionGrossTotal(
  type: string,
  quantity: number,
  price: number,
): number {
  const txType = type.toUpperCase();
  if (CASH_TYPES.has(txType)) {
    return Number.isFinite(price) ? price : 0;
  }
  if (!Number.isFinite(quantity) || !Number.isFinite(price)) return 0;
  return quantity * price;
}

export type TransactionSettlement = {
  gross: number;
  fee: number;
  tax: number;
  net: number;
  label: string;
  detail: string;
  isOutflow: boolean;
};

export function computeTransactionSettlement(
  type: string,
  quantity: number,
  price: number,
  fee: number,
  tax: number,
): TransactionSettlement | null {
  const txType = type.toUpperCase();

  if (CASH_TYPES.has(txType)) {
    if (!Number.isFinite(price) || price <= 0) return null;
    if (txType === "DEPOSIT") {
      return {
        gross: price,
        fee: 0,
        tax: 0,
        net: price,
        label: "入金總額",
        detail: "現金流入帳戶",
        isOutflow: false,
      };
    }
    return {
      gross: price,
      fee: 0,
      tax: 0,
      net: -price,
      label: "出金總額",
      detail: "現金流出帳戶",
      isOutflow: true,
    };
  }

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }

  const gross = quantity * price;
  const f = Number.isFinite(fee) ? fee : 0;
  const t = Number.isFinite(tax) ? tax : 0;

  switch (txType) {
    case "BUY":
      return {
        gross,
        fee: f,
        tax: t,
        net: -(gross + f + t),
        label: "應付總額",
        detail: "成交金額＋手續費＋稅",
        isOutflow: true,
      };
    case "SELL":
      return {
        gross,
        fee: f,
        tax: t,
        net: gross - f - t,
        label: "應收總額",
        detail: "成交金額－手續費－稅",
        isOutflow: false,
      };
    case "DIVIDEND":
      return {
        gross,
        fee: f,
        tax: t,
        net: gross - f - t,
        label: "股息入帳",
        detail: "股息－手續費－稅",
        isOutflow: false,
      };
    default:
      return null;
  }
}
