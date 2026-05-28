import {
  feeFromPermille,
  legacyFeeToPermille,
  legacyTaxToPermille,
  resolveFeePermille,
  resolveTaxPermille,
  taxFromPermille,
  type AccountFeeRules,
} from "@/lib/account-fee-rules";
import { accountHasZeroTradeFees } from "@/lib/standard-accounts";

type FeeTaxContext = {
  account: AccountFeeRules & { name?: string };
  instrument: {
    symbol: string;
    feeRateBps?: number | null;
    taxRatePct?: number | null;
  };
};

function instrumentFeePermille(
  instrument: FeeTaxContext["instrument"],
  account: AccountFeeRules,
  side: "BUY" | "SELL",
): number {
  if (instrument.feeRateBps != null) {
    return legacyFeeToPermille(Number(instrument.feeRateBps));
  }
  return resolveFeePermille(account, side);
}

function instrumentTaxPermille(
  instrument: FeeTaxContext["instrument"],
  account: AccountFeeRules,
  side: "BUY" | "SELL",
): number {
  if (instrument.taxRatePct != null) {
    return legacyTaxToPermille(Number(instrument.taxRatePct));
  }
  return resolveTaxPermille(account, side, instrument.symbol);
}

export function calculateFeeTax(
  type: string,
  quantity: number,
  price: number,
  ctx: FeeTaxContext,
  options?: { roundHalfUp?: boolean; floorWithMinOne?: boolean },
): { fee: number; tax: number } {
  const amount = quantity * price;
  const floorWithMinOne =
    options?.floorWithMinOne === true || options?.roundHalfUp === true;

  if (type === "DIVIDEND") {
    return { fee: 0, tax: 0 };
  }

  if (ctx.account.name && accountHasZeroTradeFees({ name: ctx.account.name })) {
    return { fee: 0, tax: 0 };
  }

  const side = type === "SELL" ? "SELL" : "BUY";
  const feePm = instrumentFeePermille(ctx.instrument, ctx.account, side);
  const taxPm = instrumentTaxPermille(ctx.instrument, ctx.account, side);

  return {
    fee: feeFromPermille(amount, feePm, floorWithMinOne),
    tax: taxFromPermille(amount, taxPm, floorWithMinOne),
  };
}

export function applyAutoFeeTax<T extends AccountFeeRules>(
  account: T,
  instrument: {
    symbol: string;
    feeRateBps?: number | null;
    taxRatePct?: number | null;
  },
  type: string,
  quantity: number,
  price: number,
  fee?: number,
  tax?: number,
): { fee: number; tax: number } {
  const hasFee = fee !== undefined && fee !== null && !Number.isNaN(fee);
  const hasTax = tax !== undefined && tax !== null && !Number.isNaN(tax);

  const calculated = calculateFeeTax(type, quantity, price, {
    account,
    instrument,
  }, {
    roundHalfUp: account.feeTaxRoundHalfUp === true,
  });
  return {
    fee: hasFee ? fee! : calculated.fee,
    tax: hasTax ? tax! : calculated.tax,
  };
}
