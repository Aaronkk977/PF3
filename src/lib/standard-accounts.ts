/** 標準投資帳戶（對應舊軟體匯出之 Account 欄位） */
export const STANDARD_ACCOUNTS = [
  {
    name: "台股（永豐）",
    currency: "TWD" as const,
    legacyNames: ["永豐大戶投", "永豐", "永豐台中分行"],
    color: "#00f0ff",
  },
  {
    name: "美股（Firstrade）",
    currency: "USD" as const,
    legacyNames: ["Firstrade", "firstrade"],
    color: "#00c4e0",
  },
  {
    name: "加密貨幣（Binance）",
    currency: "USD" as const,
    legacyNames: ["Binance", "binance"],
    color: "#4de8f5",
  },
] as const;

export function accountDataKey(accountId: string): string {
  return `account_${accountId}`;
}

export function matchLegacyAccountName(csvName: string): string | null {
  const trimmed = csvName.trim();
  if (!trimmed) return null;
  for (const std of STANDARD_ACCOUNTS) {
    if (std.legacyNames.some((n) => n === trimmed || trimmed.includes(n))) {
      return std.name;
    }
    if (trimmed.includes("永豐")) return STANDARD_ACCOUNTS[0].name;
    if (/firstrade/i.test(trimmed)) return STANDARD_ACCOUNTS[1].name;
    if (/binance/i.test(trimmed)) return STANDARD_ACCOUNTS[2].name;
  }
  return null;
}

/** 帳戶別名 → 標準鍵（Settings 重新命名後仍可與 CSV 欄位對應） */
export function accountCanonicalKey(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  return matchLegacyAccountName(trimmed) ?? trimmed;
}

export function standardAccountCurrency(canonicalKey: string): string {
  const std = STANDARD_ACCOUNTS.find((s) => s.name === canonicalKey);
  return std?.currency ?? "TWD";
}

/** Firstrade 等美股券商：買賣無手續費，股息可能另有預扣稅 */
export function accountHasZeroTradeFees(account: {
  name: string;
}): boolean {
  const canonical = matchLegacyAccountName(account.name) ?? account.name;
  return canonical === STANDARD_ACCOUNTS[1].name;
}
