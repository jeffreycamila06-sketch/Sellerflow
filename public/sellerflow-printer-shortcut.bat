@echo off
setlocal
set "APP_URL=https://sellerflow-pi.vercel.app/?directPrint=1"
set "PS1=%TEMP%\sellerflow-printer-shortcut.ps1"

> "%PS1%" echo $ErrorActionPreference = 'Stop'
>> "%PS1%" echo $appUrl = $env:APP_URL
>> "%PS1%" echo function Add-BrowserPath($base, $child) { if($base) { $p = Join-Path $base $child; if(Test-Path $p) { $script:candidates += $p } } }
>> "%PS1%" echo $script:candidates = @()
>> "%PS1%" echo Add-BrowserPath $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
>> "%PS1%" echo Add-BrowserPath ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'
>> "%PS1%" echo Add-BrowserPath $env:LocalAppData 'Google\Chrome\Application\chrome.exe'
>> "%PS1%" echo Add-BrowserPath $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
>> "%PS1%" echo Add-BrowserPath ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
>> "%PS1%" echo Add-BrowserPath $env:LocalAppData 'Microsoft\Edge\Application\msedge.exe'
>> "%PS1%" echo $browser = $script:candidates ^| Select-Object -First 1
>> "%PS1%" echo if(-not $browser) {
>> "%PS1%" echo   foreach($name in @('chrome.exe','msedge.exe')) {
>> "%PS1%" echo     foreach($root in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths')) {
>> "%PS1%" echo       $key = Join-Path $root $name
>> "%PS1%" echo       if(Test-Path $key) {
>> "%PS1%" echo         $value = (Get-ItemProperty -Path $key).'(default)'
>> "%PS1%" echo         if($value -and (Test-Path $value)) { $browser = $value; break }
>> "%PS1%" echo       }
>> "%PS1%" echo     }
>> "%PS1%" echo     if($browser) { break }
>> "%PS1%" echo   }
>> "%PS1%" echo }
>> "%PS1%" echo if(-not $browser) {
>> "%PS1%" echo   foreach($name in @('chrome.exe','msedge.exe')) {
>> "%PS1%" echo     $cmd = Get-Command $name -ErrorAction SilentlyContinue
>> "%PS1%" echo     if($cmd -and (Test-Path $cmd.Source)) { $browser = $cmd.Source; break }
>> "%PS1%" echo   }
>> "%PS1%" echo }
>> "%PS1%" echo if(-not $browser) {
>> "%PS1%" echo   Write-Host 'SellerFlow could not find Google Chrome or Microsoft Edge on this laptop.' -ForegroundColor Red
>> "%PS1%" echo   Write-Host 'Install Chrome or Edge first, then run Printer Shortcut again.'
>> "%PS1%" echo   pause
>> "%PS1%" echo   exit 1
>> "%PS1%" echo }
>> "%PS1%" echo $desktop = [Environment]::GetFolderPath('Desktop')
>> "%PS1%" echo $profile = Join-Path $env:LocalAppData 'SellerFlowPrintProfile'
>> "%PS1%" echo New-Item -ItemType Directory -Force -Path $profile ^| Out-Null
>> "%PS1%" echo $shortcutPath = Join-Path $desktop 'SellerFlow Direct Print.lnk'
>> "%PS1%" echo $switchUrl = $appUrl + '^&sellerLogin=1'
>> "%PS1%" echo $switchPath = Join-Path $desktop 'SellerFlow Switch Account.lnk'
>> "%PS1%" echo $shell = New-Object -ComObject WScript.Shell
>> "%PS1%" echo $shortcut = $shell.CreateShortcut($shortcutPath)
>> "%PS1%" echo $shortcut.TargetPath = $browser
>> "%PS1%" echo $shortcut.Arguments = '--user-data-dir="' + $profile + '" --kiosk-printing --app="' + $appUrl + '"'
>> "%PS1%" echo $shortcut.WorkingDirectory = Split-Path $browser
>> "%PS1%" echo $shortcut.IconLocation = $browser
>> "%PS1%" echo $shortcut.Description = 'Open SellerFlow with direct 1-click printing enabled'
>> "%PS1%" echo $shortcut.Save()
>> "%PS1%" echo $switchShortcut = $shell.CreateShortcut($switchPath)
>> "%PS1%" echo $switchShortcut.TargetPath = $browser
>> "%PS1%" echo $switchShortcut.Arguments = '--user-data-dir="' + $profile + '" --kiosk-printing --app="' + $switchUrl + '"'
>> "%PS1%" echo $switchShortcut.WorkingDirectory = Split-Path $browser
>> "%PS1%" echo $switchShortcut.IconLocation = $browser
>> "%PS1%" echo $switchShortcut.Description = 'Open SellerFlow direct print and choose a different seller login'
>> "%PS1%" echo $switchShortcut.Save()
>> "%PS1%" echo Write-Host ''
>> "%PS1%" echo Write-Host 'OK - SellerFlow Direct Print shortcuts created on your Desktop.' -ForegroundColor Green
>> "%PS1%" echo Write-Host 'IMPORTANT: Open SellerFlow using that desktop shortcut when selling.'
>> "%PS1%" echo Write-Host 'Login once in that window, choose your default printer once, then 1-click can print directly.'
>> "%PS1%" echo Write-Host 'If it opens the wrong admin/seller account, open SellerFlow Switch Account once, then login again.'
>> "%PS1%" echo Write-Host 'SellerFlow Settings will show Direct Print Active when this shortcut is used.'
>> "%PS1%" echo Write-Host ''
>> "%PS1%" echo Write-Host ('Browser used: ' + $browser)
>> "%PS1%" echo pause

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
del "%PS1%" >nul 2>nul
