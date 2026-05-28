@echo off
rem Reload PATH from registry (Explorer often keeps stale PATH until logoff)
set "PATH="
for /f "skip=2 tokens=1,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "PATH=%%B"
for /f "skip=2 tokens=1,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "PATH=%%B;%PATH%"
set "PATH=%PATH:;;=;%"
