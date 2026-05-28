@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Portfolio Performance [DEV]

echo.
echo [開發模式] 會顯示 Portfolio Dev 終端機視窗
echo 正式版請雙擊 launch.bat
echo.
echo 正在啟動開發伺服器...
echo.

start "Portfolio Dev" cmd /k cd /d "%~dp0" ^&^& npm run dev

echo 等待伺服器就緒（最多約 3 分鐘）...
set /a tries=0

:wait_loop
set /a tries+=1
if %tries% gtr 90 goto open_browser

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto open_browser

ping -n 3 127.0.0.1 >nul
goto wait_loop

:open_browser
start "" http://localhost:3000

echo.
echo 已開啟瀏覽器: http://localhost:3000
echo 開發伺服器在「Portfolio Dev」視窗中執行。
echo 關閉該視窗即可停止伺服器。
echo.
pause
