@echo off
setlocal
set "APP_URL=https://sellerflow-pi.vercel.app"
set "SHORTCUT_NAME=SellerFlow Direct Print.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$chromePaths=@($env:ProgramFiles + '\Google\Chrome\Application\chrome.exe',${env:ProgramFiles(x86)} + '\Google\Chrome\Application\chrome.exe',$env:LocalAppData + '\Google\Chrome\Application\chrome.exe');" ^
  "$chrome=$chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1;" ^
  "if(-not $chrome){ Write-Host 'Google Chrome was not found. Please install Chrome first.'; pause; exit 1 }" ^
  "$desktop=[Environment]::GetFolderPath('Desktop');" ^
  "$shortcutPath=Join-Path $desktop $env:SHORTCUT_NAME;" ^
  "$shell=New-Object -ComObject WScript.Shell;" ^
  "$shortcut=$shell.CreateShortcut($shortcutPath);" ^
  "$shortcut.TargetPath=$chrome;" ^
  "$shortcut.Arguments='--kiosk-printing --new-window ' + $env:APP_URL;" ^
  "$shortcut.WorkingDirectory=Split-Path $chrome;" ^
  "$shortcut.IconLocation=$chrome;" ^
  "$shortcut.Description='Open SellerFlow with direct 1-click printing enabled';" ^
  "$shortcut.Save();" ^
  "Write-Host 'SellerFlow Direct Print shortcut created on your Desktop.';" ^
  "Write-Host 'Use that shortcut when selling so 1-click can print directly.';" ^
  "pause"
