@echo off
setlocal
set "HELPER_DIR=%~dp0"
set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT=%DESKTOP%\SellerFlowLive Helper.url"
echo [InternetShortcut]>"%SHORTCUT%"
echo URL=file:///%HELPER_DIR:\=/%Start SellerFlowLive Helper.bat>>"%SHORTCUT%"
echo IconFile=%SystemRoot%\System32\SHELL32.dll>>"%SHORTCUT%"
echo IconIndex=220>>"%SHORTCUT%"
echo SellerFlowLive Helper shortcut created on your Desktop.
echo Open "SellerFlowLive Helper" when selling live.
pause
