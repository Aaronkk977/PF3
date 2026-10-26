@echo off
cd /d "%~dp0"
title Portfolio Performance [BUILD EXE]

echo.
echo Build Windows installer (next build + electron-builder)
echo Output: release\Portfolio Performance Setup ^<version^>.exe
echo Local package only. Does not publish to GitHub Releases.
echo Close the desktop app first, or Prisma DLL may stay locked.
echo.

call npm run build:app
if errorlevel 1 goto fail

call npx --no-install electron-builder --win -c electron-builder.config.cjs --publish never
if errorlevel 1 goto fail

echo.
echo Build succeeded.
echo.
if exist "release\" start "" explorer.exe "release"
pause
exit /b 0

:fail
echo.
echo Build failed. See the errors above.
echo.
pause
exit /b 1
