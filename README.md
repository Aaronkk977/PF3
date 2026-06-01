# Portfolio Performance

A personal portfolio tracker for Taiwan stocks, US stocks, ETFs, and crypto.  
Built with Next.js + Prisma (SQLite), focused on fast local usage and clear performance analysis.

## What This App Does

- Track holdings, watchlist symbols, and cash positions across accounts.
- Record transactions (BUY/SELL/DIVIDEND/DEPOSIT/WITHDRAWAL).
- Import transactions from CSV.
- Review trades: period fees/taxes (monthly/quarterly/yearly) and per-sell realized P&L.
- View portfolio performance with charts and benchmark comparison.
- Open instrument detail pages (price trend, trades, notes).

## Quick Start (Windows)

Open PowerShell in project root, then run:

```powershell
cd "c:\Users\User\Desktop\Porfolio Performance"
npm install
npx prisma db push
npm run db:seed
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

If `npm` is not recognized, run:

```powershell
.\dev.ps1
```

## Run Like an App (No Terminal Window)

Build once:

```powershell
npm run build:app
```

Then double-click `launch.bat` (or run `launcher\start.ps1`):

- Starts production server in background
- Opens browser in app-like mode
- Uses `%AppData%\PortfolioPerformance\` for runtime data

Stop background server:

```powershell
.\launcher\stop.ps1
```

## CSV Import

Supported CSV columns:

```csv
date,symbol,type,quantity,price,fee,tax,account,note
2025-01-10,2330.TW,BUY,100,580,20,0,台股（永豐）,
2025-02-01,,DEPOSIT,1,50000,0,0,美股（Firstrade）,
```

Legacy file conversion commands:

```powershell
npm run import:convert
npm run import:legacy
npm run accounts:ensure
```

## Symbol Rules

- Taiwan stocks: `2330.TW`, `0050.TW`
- US stocks: `AAPL`, `MSFT`
- Crypto: `BTC-USD`
- Indices: `^GSPC`
- Taiwan VIX alias in app watchlist: `VIXTWN`

## Privacy & Git Safety

Personal data files should **not** be committed to GitHub.

- Keep local secrets only in `.env` (never upload real keys).
- Keep imported personal CSV files under `data/import/`.
- Database and generated files are local-only.

Recommended before pushing:

```powershell
git status
git ls-files ".env" "data/**" "prisma/dev.db*"
```

If sensitive files are tracked, untrack them first:

```powershell
git rm --cached .env
git rm --cached data/import/legacy/All_transactions.csv
git rm --cached data/import/transactions.csv
```
