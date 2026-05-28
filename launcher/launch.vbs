' Splash via mshta (visible immediately); server via hidden PowerShell
Set fso = CreateObject("Scripting.FileSystemObject")
launcherDir = fso.GetParentFolderName(WScript.ScriptFullName)
splashHta = launcherDir & "\splash.hta"
startScript = launcherDir & "\start.ps1"
Set sh = CreateObject("WScript.Shell")
sh.Run "mshta.exe """ & splashHta & """", 1, False
WScript.Sleep 200
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & startScript & """", 0, False
