# Win32 helpers for maximizing the browser window (ASCII only)
if (-not ("NativeWin" -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class NativeWin {
  public delegate bool EnumWindowsCallback(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsCallback lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  public const int SW_MAXIMIZE = 3;
}
'@
}

function Maximize-BrowserWindow([string]$Url) {
  $portPart = ""
  if ($Url -match ":(\d+)") { $portPart = $Matches[1] }
  $callback = [NativeWin+EnumWindowsCallback]{
    param([IntPtr]$hwnd, [IntPtr]$lParam)
    if (-not [NativeWin]::IsWindowVisible($hwnd)) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [void][NativeWin]::GetWindowText($hwnd, $sb, 512)
    $title = $sb.ToString()
    if ($title.Length -lt 2) { return $true }
    if ($title -match "Portfolio Performance" -or ($portPart -ne "" -and $title -match $portPart)) {
      $script:enumTarget = $hwnd
      return $false
    }
    return $true
  }
  for ($i = 0; $i -lt 20; $i++) {
    $script:enumTarget = [IntPtr]::Zero
    [NativeWin]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    if ($script:enumTarget -ne [IntPtr]::Zero) {
      [NativeWin]::ShowWindow($script:enumTarget, [NativeWin]::SW_MAXIMIZE) | Out-Null
      [NativeWin]::SetForegroundWindow($script:enumTarget) | Out-Null
      return
    }
    Start-Sleep -Milliseconds 250
  }
}
