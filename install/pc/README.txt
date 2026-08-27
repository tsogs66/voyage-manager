Voyage Report — PC local install
================================

One-click install (Windows PowerShell):

  $f="$env:TEMP\noon-install-pc.ps1"; iwr https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/pc/install-pc.ps1 -UseBasicParsing -OutFile $f; powershell -NoProfile -ExecutionPolicy Bypass -File $f

Or download the portable ZIP from GitHub Releases / build with scripts/build-pc-portable.sh,
unzip, then double-click:

  Start Voyage Report.bat

How it works
------------
- App files are stored on this PC (%LOCALAPPDATA%\NoonReport\app or the portable folder).
- Start-NoonReport opens http://127.0.0.1:8765/voyage_manager.html (local server).
- Voyage data stays in this browser's IndexedDB — same as running locally, not online.
- Optional server sync under Setup tab is separate; the app itself always runs local.

Update (keeps local data)
-------------------------
  Double-click Update-NoonReport.bat
  or re-run the one-click install command above.

Requirements
------------
- Windows 10/11 with PowerShell 5.1+
- A modern browser (Chrome / Edge recommended)
