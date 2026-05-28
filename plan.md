# UI

- cyberpunk — ✅ 已實作（深色霓虹主題、grid 背景、發光邊框）
- clear and pretty — ✅ 已實作（卡片留白、tabular 數字、高對比配色）

# Structure

## Dashboard

- changes % of following list and holdings — ✅ 追蹤清單與持倉今日漲跌 %／金額
- 總市值、成本、未實現損益、現金 — ✅
- 持倉／資產類別／標籤配置圓餅圖 — ✅
- 有筆記欄位可記錄今日市場觀察與心得（可透過日曆回顧過去）

## Performance Analysis

- Basic analysis (IRR, absolute return, max drawdown, volatility, etc.) — ✅ 已分類顯示
  - **關鍵指標**：期間報酬、未實現報酬率、XIRR、期初／期末市值
  - **風險指標**：最大回撤、年化波動率
  - **交易指標**：勝率、手續費率、稅率、平均持有天數、已平倉筆數
- smart mechanism for fees and taxes (account / instrument) — ✅ 帳戶預設費率（bps）與稅率；標的可覆寫；新增交易可自動帶入
- compare with custom baseline (0050, S&P500, etc.) — ✅ 基準選擇＋標準化折線圖
- today's changes — ✅ 組合今日漲跌

## Holdings

- pie charts of holdings — ✅ 持倉市值配置圓餅圖
- tags on instruments (long-term, momentum, etc.) — ✅ 手動編輯＋Mock AI 建議
- LLM / smart tagging — 🔶 Mock API（`POST /api/tags/suggest`），v2 接真實 LLM
- Candlestick chart — ✅ 日線 K 線
- transaction marks on chart (buy / sell / dividend) — ✅ 箭頭／圓點標記

## Settings

- 漲跌配色：綠漲紅跌 / 紅漲綠跌（台股）— ✅
- 主題：Cyberpunk / Black & White — ✅（`/settings`）

# Feature

- fast add by company name or stock code — ✅ Yahoo 搜尋 API（`/api/instruments/search`）＋交易表單 datalist
- Taiwan / global / crypto — ✅ Yahoo 代碼（`2330.TW`、`AAPL`、`BTC-USD` 等）
- CSV import — ✅ 固定欄位匯入
- Watchlist — ✅ 追蹤清單 CRUD（`/api/watchlist`）

# 技術架構（已建）

| 層級 | 路徑 | 說明 |
|------|------|------|
| DB | `prisma/schema.prisma` | Account, Instrument, Transaction, Tag, Benchmark, Watchlist, PriceCache |
| 持倉計算 | `src/lib/portfolio-engine.ts` | 加權成本、市值、配置 |
| 績效 | `src/lib/performance.ts` | 期間報酬、MDD、波動、XIRR、基準 |
| 交易統計 | `src/lib/metrics.ts` | 勝率、費率、持有天數、XIRR 現金流 |
| 稅費 | `src/lib/fee-tax.ts` | 帳戶／標的規則自動計算 |
| 行情 | `src/lib/yahoo.ts` | 報價＋Chart API 歷史價 |
| 搜尋 | `src/lib/instrument-search.ts` | 公司名／代碼搜尋 |

# v2 待辦

- 完整 TWR（時間加權報酬，每日調整持倉）
- 真實 LLM 自動打標
- 多帳戶、FIFO 成本
- 多幣別統一報表（TWD 換算）
- 觀察清單與價格提醒
- JSON 匯出／備份
