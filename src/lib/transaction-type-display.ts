import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  BUY: "買入 BUY",
  SELL: "賣出 SELL",
  DIVIDEND: "股息 DIVIDEND",
  DEPOSIT: "入金 DEPOSIT",
  WITHDRAWAL: "出金 WITHDRAWAL",
};

export function formatTransactionType(type: string): string {
  return TYPE_LABELS[type.toUpperCase()] ?? type;
}

export function transactionTypeClass(type: string): string {
  switch (type.toUpperCase()) {
    case "BUY":
      return "trade-buy";
    case "SELL":
      return "trade-sell";
    default:
      return "text-[var(--color-muted)]";
  }
}

export function transactionTypeSelectClass(type: string): string {
  return cn(
    "font-medium",
    type === "BUY" && "trade-buy trade-buy-field",
    type === "SELL" && "trade-sell trade-sell-field",
  );
}
