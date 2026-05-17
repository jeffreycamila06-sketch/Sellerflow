@echo off
setlocal
set "APP_URL=https://sellerflow-pi.vercel.app"
set "SHORTCUT_NAME=SellerFlow Direct Print.lnk"
set "BROWSER="

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not defined BROWSER for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do set "BROWSER=%%B"
if not defined BROWSER for /f "tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do set "BROWSER=%%B"
if not defined BROWSER for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do set "BROWSER=%%B"

if not defined BROWSER for /f "delims=" %%A in ('where chrome.exe 2^>nul') do if not defined BROWSER set "BROWSER=%%A"

if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"

if not defined BROWSER (
  echo Chrome or Edge was not found. Please install Chrome first.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desktop=[Environment]::GetFolderPath('Desktop');" ^
  "$shortcutPath=Join-Path $desktop $env:SHORTCUT_NAME;" ^
  "$shell=New-Object -ComObject WScript.Shell;" ^
  "$shortcut=$shell.CreateShortcut($shortcutPath);" ^
  "$shortcut.TargetPath=$env:BROWSER;" ^
  "$shortcut.Arguments='--kiosk-printing --new-window ' + $env:APP_URL;" ^
  "$shortcut.WorkingDirectory=Split-Path $env:BROWSER;" ^
  "$shortcut.IconLocation=$env:BROWSER;" ^
  "$shortcut.Description='Open SellerFlow with direct 1-click printing enabled';" ^
  "$shortcut.Save();" ^
  "Write-Host 'SellerFlow Direct Print shortcut created on your Desktop.';" ^
  "Write-Host 'Use that shortcut when selling so 1-click can print directly.';" ^
  "pause"
