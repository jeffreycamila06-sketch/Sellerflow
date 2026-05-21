$ErrorActionPreference = "Stop"

if (-not (Test-Path "dist\SellerFlowLiveHelper.exe")) {
  .\build_exe.ps1
}

$iscc = Get-Command iscc -ErrorAction SilentlyContinue
if (-not $iscc) {
  $candidate = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
  if (Test-Path $candidate) {
    & $candidate installer.iss
  } else {
    throw "Inno Setup ISCC.exe not found. Install Inno Setup 6, then run this script again."
  }
} else {
  iscc installer.iss
}

Write-Host "Built installer-output\SellerFlowLiveHelperSetup.exe"
