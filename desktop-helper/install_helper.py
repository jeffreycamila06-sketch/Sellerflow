import ctypes
import os
import shutil
import subprocess
import sys
from pathlib import Path


def bundled_path(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    return base / name


def message(text: str, title: str = "SellerFlowLive Helper"):
    ctypes.windll.user32.MessageBoxW(None, text, title, 0x40)


def main():
    source = bundled_path("SellerFlowLiveHelper.exe")
    if not source.exists():
        message("Installer package is missing SellerFlowLiveHelper.exe", "Install failed")
        return 1

    app_dir = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "SellerFlowLiveHelper"
    app_dir.mkdir(parents=True, exist_ok=True)
    target = app_dir / "SellerFlowLiveHelper.exe"
    shutil.copy2(source, target)

    desktop = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop"
    shortcut = desktop / "SellerFlowLive Helper.lnk"
    command = (
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($args[0]);"
        "$s.TargetPath=$args[1];"
        "$s.WorkingDirectory=(Split-Path $args[1]);"
        "$s.Save()"
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command, str(shortcut), str(target)],
        check=False,
        creationflags=0x08000000,
    )
    subprocess.Popen([str(target)], close_fds=True)
    message("SellerFlowLive Helper installed and started.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
