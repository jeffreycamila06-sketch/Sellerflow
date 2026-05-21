[Setup]
AppName=SellerFlowLive Helper
AppVersion=1.0.0
DefaultDirName={autopf}\SellerFlowLive Helper
DefaultGroupName=SellerFlowLive Helper
OutputDir=installer-output
OutputBaseFilename=SellerFlowLiveHelperSetup
Compression=lzma
SolidCompression=yes

[Files]
Source: "dist\SellerFlowLiveHelper.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\SellerFlowLive Helper"; Filename: "{app}\SellerFlowLiveHelper.exe"
Name: "{commondesktop}\SellerFlowLive Helper"; Filename: "{app}\SellerFlowLiveHelper.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "{app}\SellerFlowLiveHelper.exe"; Description: "Launch SellerFlowLive Helper"; Flags: nowait postinstall skipifsilent
