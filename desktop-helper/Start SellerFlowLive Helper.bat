@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  node helper.js
  goto end
)
if exist "..\mobile\.tools\node\node.exe" (
  "..\mobile\.tools\node\node.exe" helper.js
  goto end
)
echo Node.js was not found.
echo Please install Node.js or run this helper from the SellerFlowLive project folder.
:end
pause
