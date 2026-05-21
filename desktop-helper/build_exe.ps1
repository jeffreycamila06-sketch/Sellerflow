$ErrorActionPreference = "Stop"

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
$python = if ($pythonCmd) { $pythonCmd.Source } else { "" }
if (-not $python) {
  $pyCmd = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCmd) { $python = $pyCmd.Source }
}
if (-not $python) { throw "Python 3 is required to build SellerFlowLive Helper." }

if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
  Write-Host "PyInstaller is not installed. Installing..."
  & $python -m pip install pyinstaller
}

& $python -m PyInstaller --noconfirm --onefile --windowed --name SellerFlowLiveHelper sellerflow_live_helper.py
Write-Host "Built dist\SellerFlowLiveHelper.exe"
