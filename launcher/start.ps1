# Portfolio Performance desktop launcher (hidden; splash is splash.hta)
$ErrorActionPreference = "Stop"

$LauncherDir = $PSScriptRoot
$ProjectRoot = Split-Path $LauncherDir -Parent
$configPath = Join-Path $LauncherDir "config.json"

$port = 3847
$listenHost = "127.0.0.1"
$healthTimeoutSeconds = 120
$browserAppMode = $true
$browserMaximized = $true

if (Test-Path $configPath) {
  $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($cfg.port) { $port = [int]$cfg.port }
  if ($cfg.listenHost) { $listenHost = [string]$cfg.listenHost }
  if ($cfg.healthTimeoutSeconds) { $healthTimeoutSeconds = [int]$cfg.healthTimeoutSeconds }
  if ($null -ne $cfg.browserAppMode) { $browserAppMode = [bool]$cfg.browserAppMode }
  if ($null -ne $cfg.browserMaximized) { $browserMaximized = [bool]$cfg.browserMaximized }
  elseif ($null -ne $cfg.browserFullscreen) { $browserMaximized = [bool]$cfg.browserFullscreen }
}

$baseUrl = "http://${listenHost}:${port}"

function Refresh-PathFromRegistry {
  $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Resolve-NodeExe {
  $prefer = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\node\node.exe")
  )
  foreach ($p in $prefer) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -notmatch "WindowsApps|Cursor|VS Code|Antigravity") {
    return $cmd.Source
  }
  throw "Node.js not found. Install from https://nodejs.org then sign out/in and run launch.bat again."
}

function Close-Splash {
  Set-Content -Path $script:splashOffFile -Value "1" -Encoding ascii -ErrorAction SilentlyContinue
}

# 這台機器上觀察到 node.exe 啟動後幾秒內會在新的 PID 下重新出現（原本
# Start-Process 拿到的 process 物件很快變成 HasExited=$true，但 port 上其實
# 一直有另一個 PID 的 node.exe 正常在serve）。原因不明（可能跟防毒即時掃描
# 或這版 Node 在 Windows 上的行為有關），但只信 HasExited 會把「其實活著、
# 只是換了 PID」誤判成「啟動失敗」。改用「port 有沒有人在聽」當作活著的
# 真正依據，HasExited 只在 port 也沒人聽時才當作真的掛了。
function Test-PortListening([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Show-SplashError([string]$Message) {
  $utf8 = New-Object System.Text.UTF8Encoding $true
  [System.IO.File]::WriteAllText($script:splashErrorFile, $Message, $utf8)
  Start-Sleep -Seconds 8
}

Refresh-PathFromRegistry
foreach ($dir in @(
    (Join-Path $env:ProgramFiles "nodejs"),
    (Join-Path $env:LOCALAPPDATA "Programs\node")
  )) {
  if ($dir -and (Test-Path -LiteralPath $dir)) {
    $env:Path = "$dir;$env:Path"
  }
}

$script:appData = Join-Path $env:APPDATA "PortfolioPerformance"
$script:dataDir = Join-Path $script:appData "data"
$script:importDir = Join-Path $script:appData "import"
$script:legacyDir = Join-Path $script:importDir "legacy"
$script:dbFile = Join-Path $script:dataDir "portfolio.db"
$script:pidFile = Join-Path $script:appData "server.pid"
$script:splashOffFile = Join-Path $script:appData "splash.off"
$script:splashErrorFile = Join-Path $script:appData "splash.error"

try {
  New-Item -ItemType Directory -Force -Path $script:appData, $script:dataDir, $script:importDir, $script:legacyDir | Out-Null
  if (Test-Path $script:splashOffFile) { Remove-Item $script:splashOffFile -Force -ErrorAction SilentlyContinue }
  if (Test-Path $script:splashErrorFile) { Remove-Item $script:splashErrorFile -Force -ErrorAction SilentlyContinue }

  if (Test-Path $script:pidFile) {
    $oldPid = (Get-Content $script:pidFile -Raw).Trim()
    if ($oldPid -match '^\d+$') {
      $proc = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
      if ($proc -and $proc.ProcessName -eq "node") {
        Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
      }
    }
    Remove-Item $script:pidFile -Force -ErrorAction SilentlyContinue
  }

  # server.pid 只認得「上一次由 launcher 啟動」的 server。手動跑過 server.js、
  # 或上一次沒收乾淨時，port 會被一個 pid file 不知道的 node 佔住；這時新開的
  # server 會因為 EADDRINUSE 立刻結束，下面的健康檢查只看得到 HasExited，就會
  # 報成「Server exited early」→ 啟動畫面顯示「請重新執行 npm run build:app」，
  # 完全指錯方向（build 是好的，只是 port 被佔走）。先收掉佔用者。
  $stale = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if ($stale.Count -gt 0) {
    foreach ($conn in $stale) {
      $owner = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
      if ($owner -and $owner.ProcessName -eq "node") {
        Stop-Process -Id $owner.Id -Force -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Seconds 1
  }

  if (-not (Test-Path $script:dbFile)) {
    $candidates = @(
      (Join-Path $ProjectRoot "dev.db"),
      (Join-Path $ProjectRoot "prisma\dev.db")
    )
    $copied = $false
    foreach ($src in $candidates) {
      if (Test-Path $src) {
        Copy-Item $src $script:dbFile -Force
        $copied = $true
        break
      }
    }
    if (-not $copied) {
      $schema = Join-Path $ProjectRoot "prisma\schema.prisma"
      if (-not (Test-Path $schema)) {
        throw "Missing prisma\schema.prisma. Run: npm run build:app"
      }
      $dbUrl = "file:$($script:dbFile.Replace('\', '/'))?socket_timeout=60"
      Push-Location $ProjectRoot
      try {
        $env:DATABASE_URL = $dbUrl
        & npx prisma db push --schema $schema 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Database init failed (prisma db push)" }
      } finally {
        Pop-Location
      }
    }
  }

  $standaloneDir = Join-Path $ProjectRoot ".next\standalone"
  $serverJs = Join-Path $standaloneDir "server.js"
  if (-not (Test-Path $serverJs)) {
    throw "Production build missing. Run: npm run build:app then launch.bat"
  }

  $dbUrl = "file:$($script:dbFile.Replace('\', '/'))?socket_timeout=60"
  $env:NODE_ENV = "production"
  $env:APP_RUNTIME = "desktop"
  $env:APP_DATA_DIR = $script:appData
  $env:DATABASE_URL = $dbUrl
  $env:PORT = "$port"
  $env:HOSTNAME = $listenHost

  $node = Resolve-NodeExe
  $serverProcess = Start-Process `
    -FilePath $node `
    -ArgumentList "server.js" `
    -WorkingDirectory $standaloneDir `
    -WindowStyle Hidden `
    -PassThru

  # 先寫下 Start-Process 拿到的 PID，等確認真的活著之後會用 port 的實際
  # owner 覆寫一次（見下方，處理 PID 中途換過的狀況）。
  $serverProcess.Id | Out-File -FilePath $script:pidFile -Encoding ascii -NoNewline

  # 先等 server process 真的能回應（活著），再等 /api/startup/status 回報
  # 開機維護（股票分割偵測＋幣別／追蹤清單名稱校正）跑完，啟動畫面才關閉。
  # 這樣使用者看到畫面出現時，後續切換頁面就不會再被這些維護工作拖慢。
  $deadline = (Get-Date).AddSeconds($healthTimeoutSeconds)
  $serverAlive = $false
  while ((Get-Date) -lt $deadline) {
    if ($serverProcess.HasExited -and -not (Test-PortListening $port)) {
      throw "Server exited early. Run: npm run build:app"
    }
    try {
      $null = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 2
      $serverAlive = $true
      break
    } catch {
      Start-Sleep -Milliseconds 400
    }
  }
  if (-not $serverAlive) {
    throw "Server did not respond in ${healthTimeoutSeconds}s on $baseUrl"
  }

  # 確認活著之後，用「port 實際 owner」覆寫 pid file——如果中途換過 PID，
  # 下次啟動的 stale-process 清理才抓得到真正在跑的那個。
  $actualOwner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty OwningProcess)
  if ($actualOwner) {
    $actualOwner | Out-File -FilePath $script:pidFile -Encoding ascii -NoNewline
  }

  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ($serverProcess.HasExited -and -not (Test-PortListening $port)) {
      throw "Server exited early. Run: npm run build:app"
    }
    try {
      $null = Invoke-WebRequest -Uri "$baseUrl/api/startup/status" -UseBasicParsing -TimeoutSec 30
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 400
    }
  }
  if (-not $ready) {
    throw "Startup maintenance did not finish in ${healthTimeoutSeconds}s on $baseUrl"
  }

  $browser = $null
  foreach ($p in @(
      (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
      (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
      (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
      (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
    )) {
    if ($p -and (Test-Path -LiteralPath $p)) { $browser = $p; break }
  }

  Close-Splash
  Start-Sleep -Milliseconds 200

  if ($browser) {
    if ($browserAppMode) {
      $browserArgs = @("--app=$baseUrl", "--new-window")
    } else {
      $browserArgs = @($baseUrl, "--new-window")
    }
    if ($browserMaximized) { $browserArgs += "--start-maximized" }
    Start-Process -FilePath $browser -ArgumentList $browserArgs
    if ($browserMaximized) {
      . (Join-Path $LauncherDir "win32-maximize.ps1")
      Maximize-BrowserWindow $baseUrl
    }
  } else {
    Start-Process $baseUrl
  }

  exit 0
} catch {
  Show-SplashError $_.Exception.Message
  exit 1
}
