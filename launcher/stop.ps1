$appData = Join-Path $env:APPDATA "PortfolioPerformance"
$pidFile = Join-Path $appData "server.pid"

if (-not (Test-Path $pidFile)) {
  Write-Host "找不到執行中的伺服器 (無 server.pid)。" -ForegroundColor Yellow
  exit 0
}

$pidText = (Get-Content $pidFile -Raw).Trim()
if ($pidText -notmatch '^\d+$') {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "已清除無效的 pid 檔。" -ForegroundColor Yellow
  exit 0
}

$proc = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
if ($proc) {
  Stop-Process -Id ([int]$pidText) -Force
  Write-Host "已停止伺服器 (PID $pidText)。" -ForegroundColor Green
} else {
  Write-Host "程序 $pidText 已不存在。" -ForegroundColor Yellow
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
