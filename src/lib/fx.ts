import {
  getExchangeRate,
  normalizeCurrencyCode,
} from "@/lib/fx-rates";

const BASE_CURRENCY = "TWD";

export async function getUsdToTwdRate(): Promise<number> {
  const rate = await getExchangeRate("USD", "TWD");
  return rate ?? 32;
}

export async function toBaseCurrency(
  amount: number,
  currency: string | null | undefined,
  baseCurrency: string = BASE_CURRENCY,
): Promise<number> {
  const from = normalizeCurrencyCode(currency);
  const to = normalizeCurrencyCode(baseCurrency);
  if (from === to) return amount;

  const rate = await getExchangeRate(from, to);
  if (rate == null) {
    if (from === "USD" && to === "TWD") {
      return amount * (await getUsdToTwdRate());
    }
    return amount;
  }
  return amount * rate;
}

/** 將基準幣金額換算為指定幣別（toBaseCurrency 的逆運算） */
export async function fromBaseCurrency(
  amount: number,
  currency: string | null | undefined,
  baseCurrency: string = BASE_CURRENCY,
): Promise<number> {
  const to = normalizeCurrencyCode(currency);
  const from = normalizeCurrencyCode(baseCurrency);
  if (from === to) return amount;

  const rate = await getExchangeRate(from, to);
  if (rate == null) {
    if (from === "TWD" && to === "USD") {
      return amount / (await getUsdToTwdRate());
    }
    return amount;
  }
  return amount * rate;
}

export { BASE_CURRENCY, normalizeCurrencyCode };
