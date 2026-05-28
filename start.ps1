# Launch dev server and open browser
$ErrorActionPreference = "Stop"

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User")

$root = $PSScriptRoot
Set-Location $root

$url = "http://localhost:3000"

Write-Host "Starting Portfolio Performance dev server..." -ForegroundColor Cyan

$devCmd = "cd /d `"$root`" && title Portfolio Dev && npm run dev"
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $devCmd -WorkingDirectory $root

Write-Host "Waiting for server..." -ForegroundColor Yellow

$ready = $false
for ($i = 0; $i -lt 90; $i++) {
  try {
    $null = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}

Start-Process $url

if ($ready) {
  Write-Host "Browser opened: $url" -ForegroundColor Green
} else {
  Write-Host "Server still starting; browser opened. Refresh if the page fails to load." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Dev server runs in the Portfolio Dev window. Close it to stop the server." -ForegroundColor Gray
Write-Host ""
Read-Host "Press Enter to close this window"
