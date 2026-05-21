@echo off
setlocal
set "APPDIR=%LOCALAPPDATA%\SellerFlowLiveHelper"
if not exist "%APPDIR%" mkdir "%APPDIR%"
copy /Y "%~dp0SellerFlowLiveHelper.exe" "%APPDIR%\SellerFlowLiveHelper.exe" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$desktop=[Environment]::GetFolderPath('Desktop');$target=Join-Path $env:LOCALAPPDATA 'SellerFlowLiveHelper\SellerFlowLiveHelper.exe';$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'SellerFlowLive Helper.lnk'));$shortcut.TargetPath=$target;$shortcut.WorkingDirectory=(Split-Path $target);$shortcut.Save()"
start "" "%APPDIR%\SellerFlowLiveHelper.exe"
endlocal
