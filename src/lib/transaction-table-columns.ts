export type TxColumnId =
  | "date"
  | "symbol"
  | "account"
  | "type"
  | "quantity"
  | "price"
  | "fee"
  | "tax"
  | "total"
  | "note";

export const TX_COLUMN_LABELS: Record<TxColumnId, string> = {
  date: "日期",
  symbol: "標的／名稱",
  account: "帳戶",
  type: "類型",
  quantity: "數量",
  price: "價格/金額",
  fee: "手續費",
  tax: "稅",
  total: "總金額",
  note: "備註",
};

export const DEFAULT_TX_COLUMN_ORDER: TxColumnId[] = [
  "date",
  "symbol",
  "account",
  "type",
  "quantity",
  "price",
  "fee",
  "tax",
  "total",
  "note",
];

const ALL_COLUMNS = new Set<TxColumnId>(DEFAULT_TX_COLUMN_ORDER);

export function normalizeTxColumnOrder(order: unknown): TxColumnId[] {
  if (!Array.isArray(order)) return [...DEFAULT_TX_COLUMN_ORDER];
  const seen = new Set<TxColumnId>();
  const result: TxColumnId[] = [];
  for (const id of order) {
    if (typeof id !== "string" || !ALL_COLUMNS.has(id as TxColumnId)) continue;
    const col = id as TxColumnId;
    if (seen.has(col)) continue;
    seen.add(col);
    result.push(col);
  }
  for (const col of DEFAULT_TX_COLUMN_ORDER) {
    if (!seen.has(col)) result.push(col);
  }
  return result;
}

export function reorderTxColumns(
  order: TxColumnId[],
  from: TxColumnId,
  to: TxColumnId,
): TxColumnId[] {
  if (from === to) return order;
  const next = [...order];
  const fromIdx = next.indexOf(from);
  const toIdx = next.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return order;
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, from);
  return next;
}
