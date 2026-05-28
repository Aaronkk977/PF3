import { prisma } from "@/lib/db";
import {
  accountCanonicalKey,
  matchLegacyAccountName,
  standardAccountCurrency,
} from "@/lib/standard-accounts";
import { toNumber } from "@/lib/utils";

export async function listAccounts() {
  return prisma.account.findMany({ orderBy: { name: "asc" } });
}

export function serializeAccount(
  a: {
    id: string;
    name: string;
    currency: string;
    feeRateBps: unknown;
    taxRatePct: unknown;
    feeRateBpsBuy?: unknown | null;
    feeRateBpsSell?: unknown | null;
    taxRatePctBuy?: unknown | null;
    taxRatePctSell?: unknown | null;
    feeTaxRoundHalfUp?: boolean | null;
  },
  cash: number,
) {
  return {
    id: a.id,
    name: a.name,
    currency: a.currency,
    cash,
    feeRateBps: toNumber(a.feeRateBps),
    taxRatePct: toNumber(a.taxRatePct),
    feeRateBpsBuy:
      a.feeRateBpsBuy != null ? toNumber(a.feeRateBpsBuy) : null,
    feeRateBpsSell:
      a.feeRateBpsSell != null ? toNumber(a.feeRateBpsSell) : null,
    taxRatePctBuy: a.taxRatePctBuy != null ? toNumber(a.taxRatePctBuy) : null,
    taxRatePctSell:
      a.taxRatePctSell != null ? toNumber(a.taxRatePctSell) : null,
    feeTaxRoundHalfUp: a.feeTaxRoundHalfUp === true,
  };
}

export type SerializedAccount = ReturnType<typeof serializeAccount>;

export async function listAccountsWithComputedCash() {
  const accounts = await listAccounts();
  const cashMap = await computeAllAccountsCash();
  return accounts.map((a) =>
    serializeAccount(a, cashMap.get(a.id) ?? 0),
  );
}

/** 依 CSV／別名尋找既有帳戶（含 Settings 重新命名後） */
export async function findAccountByLabel(label: string) {
  const key = accountCanonicalKey(label);
  if (!key) return null;
  const accounts = await prisma.account.findMany();
  return (
    accounts.find((a) => accountCanonicalKey(a.name) === key) ??
    accounts.find((a) => a.name === key) ??
    null
  );
}

export async function getOrCreateAccount(
  accountId?: string,
  accountName?: string,
): Promise<{ id: string; name: string; currency: string; cash: number }> {
  if (accountId) {
    const acc = await prisma.account.findUnique({ where: { id: accountId } });
    if (!acc) throw new Error("帳戶不存在");
    return {
      id: acc.id,
      name: acc.name,
      currency: acc.currency,
      cash: toNumber(acc.cash),
    };
  }

  if (accountName?.trim()) {
    const name = accountName.trim();
    const existing = await findAccountByLabel(name);
    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        currency: existing.currency,
        cash: toNumber(existing.cash),
      };
    }
    const canonical = matchLegacyAccountName(name) ?? name;
    const created = await prisma.account.create({
      data: {
        name: canonical,
        currency: standardAccountCurrency(canonical),
        cash: 0,
      },
    });
    return {
      id: created.id,
      name: created.name,
      currency: created.currency,
      cash: 0,
    };
  }

  const first = await prisma.account.findFirst({ orderBy: { createdAt: "asc" } });
  if (first) {
    return {
      id: first.id,
      name: first.name,
      currency: first.currency,
      cash: toNumber(first.cash),
    };
  }

  const created = await prisma.account.create({
    data: { name: "預設帳戶", currency: "TWD", cash: 0 },
  });
  return {
    id: created.id,
    name: created.name,
    currency: created.currency,
    cash: 0,
  };
}

/** 依交易回放計算帳戶現金（含買賣、入出金、股息） */
export async function computeAccountCashFromTransactions(
  accountId: string,
): Promise<number> {
  const txs = await prisma.transaction.findMany({
    where: { accountId },
    orderBy: { date: "asc" },
  });
  let cash = 0;
  for (const tx of txs) {
    const qty = toNumber(tx.quantity);
    const price = toNumber(tx.price);
    const fee = toNumber(tx.fee);
    const tax = toNumber(tx.tax);
    const gross = qty * price;
    switch (tx.type) {
      case "DEPOSIT":
        cash += gross;
        break;
      case "WITHDRAWAL":
        cash -= gross;
        break;
      case "BUY":
        cash -= gross + fee + tax;
        break;
      case "SELL":
        cash += gross - fee - tax;
        break;
      case "DIVIDEND":
        cash += gross;
        break;
    }
  }
  return cash;
}

/** 批次回放所有帳戶現金 */
export async function computeAllAccountsCash(): Promise<Map<string, number>> {
  const txs = await prisma.transaction.findMany({ orderBy: { date: "asc" } });
  const map = new Map<string, number>();
  for (const tx of txs) {
    const qty = toNumber(tx.quantity);
    const price = toNumber(tx.price);
    const fee = toNumber(tx.fee);
    const tax = toNumber(tx.tax);
    const gross = qty * price;
    const cur = map.get(tx.accountId) ?? 0;
    switch (tx.type) {
      case "DEPOSIT":
        map.set(tx.accountId, cur + gross);
        break;
      case "WITHDRAWAL":
        map.set(tx.accountId, cur - gross);
        break;
      case "BUY":
        map.set(tx.accountId, cur - gross - fee - tax);
        break;
      case "SELL":
        map.set(tx.accountId, cur + gross - fee - tax);
        break;
      case "DIVIDEND":
        map.set(tx.accountId, cur + gross);
        break;
    }
  }
  return map;
}

export async function reconcileAccountCash(accountId: string): Promise<number> {
  const cash = await computeAccountCashFromTransactions(accountId);
  await prisma.account.update({
    where: { id: accountId },
    data: { cash },
  });
  return cash;
}

export async function adjustAccountCash(accountId: string): Promise<void> {
  await reconcileAccountCash(accountId);
}
