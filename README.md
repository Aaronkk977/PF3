# Portfolio Performance

A personal portfolio tracker for Taiwan stocks, US stocks, ETFs, and crypto.
Built with Next.js + Prisma (SQLite), packaged as a Windows desktop app with
auto-update, focused on fast local usage and clear performance analysis.

## Features

**Dashboard**
- Total assets, cash, today's change, unrealized P&L at a glance.
- Per-account performance summary.
- Multiple watchlists with drag-to-reorder (both between lists and within a
  list), live quotes, today/weekly change, background auto-refresh.
- Built-in stock screener (turnover, change %, N-day high, BIAS/MA deviation)
  with one click add-to-watchlist.

**Holdings**
- Current positions with market value, unrealized P&L, and category tags.
- Today's per-holding change breakdown.

**Transactions**
- Record BUY / SELL / DIVIDEND / DEPOSIT / WITHDRAWAL across multiple accounts.
- Inline edit and delete directly in the table (also available from each
  instrument's detail page).
- Filterable, sortable, drag-to-reorder columns; CSV import.

**Trades**
- Period fees/taxes breakdown (monthly/quarterly/yearly).
- Per-sell realized P&L (FIFO).

**Performance**
- Portfolio value over time vs. benchmarks (e.g. 0050.TW, ^TWII, S&P 500).
- Selectable date range, accounts, and benchmark set; server-side cached and
  streamed for fast reloads.

**Instrument detail pages**
- Candlestick chart with volume, MA10/20/60/250, and buy/sell trade markers.
- Realized/unrealized P&L, week/month/quarter/year change.
- Markdown investment notes, tags, and inline transaction editing.
- Chinese company names resolved via TWSE/TPEx official code-query APIs.

**Market data**
- Daily TWSE/TPEx snapshot sync with holiday cross-validation, incremental
  (skip already-synced dates) and parallelized for speed.

**MCP trading review**
- `scripts/mcp-server.ts` exposes a `get_trading_review` tool over MCP so
  Claude Code (or any MCP client) can analyze trading activity for a given
  period directly from the local database.

**Settings**
- Cyberpunk / Monochrome / Noir themes, red-up or green-up color convention,
  base settlement currency.

## Tech Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Prisma ORM + SQLite
- Tailwind CSS, lightweight-charts, recharts
- Electron + electron-builder + electron-updater (desktop packaging & auto-update)
- yahoo-finance2 + TWSE/TPEx open APIs for quotes and company data

## Quick Start (Web Dev Mode)

```powershell
cd "c:\Users\User\Desktop\Porfolio Performance"
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Desktop App (Electron)

The app also ships as a Windows desktop installer with local SQLite storage
and automatic updates via GitHub Releases.

**Run in dev mode** (loads the built standalone server in an Electron window):

```powershell
npm run build:app
npm run electron:dev
```

**Build the installer:**

```powershell
npm run dist:win
```

Produces `release/Portfolio Performance Setup <version>.exe` — a one-click
installer. Desktop app data lives at `%AppData%\PortfolioPerformance\`,
independent of the source checkout.

**Publish a new version to users:**

```powershell
npm version patch          # bumps package.json version + creates a git tag
git push origin main --tags
```

Pushing a `v*.*.*` tag triggers `.github/workflows/release.yml`, which builds
the installer on `windows-latest` and publishes it to GitHub Releases.
Installed apps check this feed on launch and self-update in the background.

> First run after install may trigger a Windows SmartScreen warning (the
> installer isn't code-signed yet) — click "More info → Run anyway".

## Database (Prisma Migrate)

Schema changes are tracked as migrations (not `db push`), so upgrades apply
safely to a real user's existing database without risking data loss.

```powershell
npm run db:migrate     # create + apply a new migration in dev (prisma migrate dev)
npx prisma migrate deploy   # apply pending migrations only, non-interactive
```

The desktop app runs `prisma migrate deploy` automatically on every launch.

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

- Taiwan stocks: `2330.TW` (TWSE), `6547.TWO` (TPEx)
- US stocks: `AAPL`, `MSFT`
- Crypto: `BTC-USD`
- Indices: `^GSPC`, `^TWII`
- Taiwan VIX alias in app watchlist: `VIXTWN`

## MCP Server (Trading Review)

Registered in `.claude/settings.json`. Once loaded in a Claude Code session,
ask things like "review my trades from the last month" and it will query the
local database directly via the `get_trading_review` tool.

## Market Data Sync

```powershell
npm run market:sync              # today
npm run market:sync:history -- 12   # backfill last 12 months
```

## Privacy & Git Safety

Personal data files should **not** be committed to GitHub.

- Keep local secrets only in `.env` (never upload real keys).
- Keep imported personal CSV files under `data/import/`.
- Database and generated files (including the Electron desktop app's
  `%AppData%\PortfolioPerformance\`) are local-only.

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

## Troubleshooting

If a build gets stuck or the dev server won't restart cleanly:

```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force .next
npm run build:app
```
