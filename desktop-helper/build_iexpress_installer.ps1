$ErrorActionPreference = "Stop"

if (-not (Test-Path "dist\SellerFlowLiveHelper.exe")) {
  .\build_exe.ps1
}

New-Item -ItemType Directory -Force -Path "installer-output" | Out-Null

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
$python = if ($pythonCmd) { $pythonCmd.Source } else { "" }
if (-not $python) {
  $pyCmd = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCmd) { $python = $pyCmd.Source }
}
if (-not $python) { throw "Python 3 is required to build SellerFlowLive Helper installer." }

& $python -m PyInstaller `
  --noconfirm `
  --onefile `
  --windowed `
  --name SellerFlowLiveHelperSetup `
  --distpath installer-output `
  --workpath build\installer `
  --add-binary "dist\SellerFlowLiveHelper.exe;." `
  install_helper.py

Write-Host "Built installer-output\SellerFlowLiveHelperSetup.exe"
