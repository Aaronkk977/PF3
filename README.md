# Portfolio Performance

Cyberpunk-styled portfolio tracker MVP built with Next.js, Prisma (SQLite), and Yahoo Finance.

## Features

- Dashboard with portfolio summary and allocation charts
- Holdings with tags and links to candlestick charts
- Transaction ledger with CSV import
- Performance analysis with benchmark comparison (simplified)
- Instrument detail pages with K-line charts and tag editing

## Setup

Open a **new** PowerShell or Command Prompt (so `npm` is on PATH), then:

```powershell
cd "c:\Users\User\Desktop\Porfolio Performance"
npm install
npx prisma db push
npm run db:seed
npm run dev
```

If PowerShell says `npm` is not recognized, either **restart Cursor** or run:

```powershell
.\dev.ps1
```

Or refresh PATH in the current window:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 正式版啟動（純啟動器，無雙終端）

建置一次：

```powershell
npm run build:app
```

之後雙擊 **`launch.bat`**（或 `launcher\start.ps1`）：

- 背景啟動 `next` 正式伺服器（無 CMD 視窗）
- 自動開啟瀏覽器（App 模式）
- 資料庫與匯入目錄：`%AppData%\PortfolioPerformance\`

停止背景伺服器：

```powershell
.\launcher\stop.ps1
```

| 檔案 | 用途 |
|------|------|
| `launch.bat` | 正式版，給使用者 |
| `run.bat` | 開發模式（`npm run dev` + 可見終端機） |

## Troubleshooting

### `next/font` / `lightningcss` / `rm: cannot remove node_modules` (WSL)

**Cause:** Running `npm` in **WSL** on a Windows folder (`/mnt/c/...`) while `node_modules` was built for Windows. Native `.node` / `.dll` files get locked and WSL `rm` fails with `Input/output error`.

**Recommended:** Use **Windows PowerShell** only (same project folder):

```powershell
cd "c:\Users\User\Desktop\Porfolio Performance"
npm run dev
```

**If you must reinstall dependencies:**

1. Stop all dev servers (`Ctrl+C`) and close extra terminals.
2. In **PowerShell** (not WSL):

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
cd "c:\Users\User\Desktop\Porfolio Performance"
npx rimraf node_modules .next
npm install
npm run dev
```

Do **not** use `rm -rf node_modules` from WSL on `/mnt/c/` paths — it often cannot delete `.prisma` or `@next/swc` Windows binaries.

**If you insist on WSL:** copy the project to the Linux filesystem (e.g. `~/portfolio`), then `npm install` and `npm run dev` there — not on `/mnt/c/`.

## 匯入資料位置

| 檔案 | 說明 |
|------|------|
| `data/import/legacy/All_transactions.csv` | 舊軟體原始匯出（保留備份） |
| `data/import/transactions.csv` | 轉換後的標準格式（程式可直接匯入） |

從根目錄 `All_transactions.csv` 轉換並複製到上述路徑：

```powershell
npm run import:convert
npm run import:legacy
npm run accounts:ensure
```

## CSV 標準格式

```csv
date,symbol,type,quantity,price,fee,tax,account,note
2025-01-10,2330.TW,BUY,100,580,20,0,台股（永豐）,
2025-02-01,,DEPOSIT,1,50000,0,0,美股（Firstrade）,
```

亦支援直接上傳舊版 `All_transactions.csv`（Transactions 頁面匯入）。

## Symbol Conventions (Yahoo Finance)

- Taiwan stocks: `2330.TW`, `0050.TW`
- US stocks: `AAPL`, `MSFT`
- Crypto: `BTC-USD`
- Indices: `^GSPC`
