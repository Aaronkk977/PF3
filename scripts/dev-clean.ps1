# Stop dev servers, clear .next cache, restart Next.js
$ErrorActionPreference = "SilentlyContinue"
Get-Process node | Stop-Process -Force
Start-Sleep -Seconds 2

Set-Location $PSScriptRoot\..

if (Test-Path .next) {
  Remove-Item -Recurse -Force .next
}

Write-Host "Starting dev server (Turbopack + Tailwind v4)..." -ForegroundColor Cyan
npm run dev
