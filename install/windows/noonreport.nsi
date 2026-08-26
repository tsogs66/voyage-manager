; Noon Report — Windows installer
;
; Built on Linux with makensis (see scripts/build-windows-installer.sh), so the
; release can be produced by CI without a Windows machine.
;
; Two decisions worth stating, because both are about where this runs — ships:
;
;   1. Per-user install, no administrator rights. A vessel's office PC is usually
;      a locked-down domain machine and the engineer is not a local admin. Anything
;      needing an admin prompt does not get installed at sea, so everything lands in
;      %LOCALAPPDATA% and every registry write is HKCU.
;
;   2. No bundled runtime. The app is served to the machine's own browser from a
;      loopback HTTP server written in PowerShell, which every supported Windows
;      already has. Bundling a browser engine would add ~150 MB to a download that
;      often arrives over a metered satellite link, and would need updating for its
;      own security fixes. The whole payload here is about a megabyte.
;
; It runs entirely offline. Server sync is configured inside the app and is optional;
; nothing in the install or the launcher reaches the network.

Unicode true
ManifestDPIAware true

!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "NoonReport-Setup.exe"
!endif
!ifndef PAYLOAD_DIR
  !define PAYLOAD_DIR "payload"
!endif

!define APP_NAME     "Noon Report"
!define APP_PUBLISHER "Noon Report"
!define APP_ID       "NoonReport"
!define APP_EXE      "Start Noon Report.bat"
!define UNINST_KEY   "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\${APP_ID}"
InstallDirRegKey HKCU "Software\${APP_ID}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUnInstDetails show

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "CompanyName"     "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME} offline installer"
VIAddVersionKey "FileVersion"     "${APP_VERSION}"
VIAddVersionKey "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey "LegalCopyright"  "${APP_PUBLISHER}"

!define MUI_ICON   "noonreport.ico"
!define MUI_UNICON "noonreport.ico"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT  "This installs ${APP_NAME} on this PC.$\r$\n$\r$\nIt runs completely offline — no internet connection is needed to log a watch, keep the e-ORB, or print a report. Connecting to a sync server stays available and is switched on inside the app, under Setup.$\r$\n$\r$\nNo administrator rights are required. Everything is installed for the current user only."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APP_NAME} now"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Read how it works"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Application" SEC_APP
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; Replacing a running install: the launcher holds the folder open while it serves,
  ; so overwrite what we can and let the rest go on next start rather than failing.
  SetOverwrite try
  File /r "${PAYLOAD_DIR}\*.*"
  File "noonreport.ico"

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\noonreport.ico" 0
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\noonreport.ico" 0

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\${APP_ID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\${APP_ID}" "Version" "${APP_VERSION}"

  ; Appear in Settings > Apps like any other program, so it can be removed the
  ; ordinary way rather than by deleting a folder.
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\noonreport.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME}"

  ; Named files only, then RMDir without /r. Voyage data lives in the browser
  ; profile, not here, but an engineer may well have saved an export or a scanned
  ; document into the install folder — a blind recursive delete would take it.
  Delete "$INSTDIR\voyage_manager.html"
  Delete "$INSTDIR\eorb.js"
  Delete "$INSTDIR\ship_time.js"
  Delete "$INSTDIR\sw.js"
  Delete "$INSTDIR\manifest.webmanifest"
  Delete "$INSTDIR\noonreport.ico"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\Start-NoonReport.ps1"
  Delete "$INSTDIR\Update-NoonReport.bat"
  Delete "$INSTDIR\Update-NoonReport.ps1"
  Delete "$INSTDIR\install-pc.ps1"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\icons\*.png"
  RMDir  "$INSTDIR\icons"
  RMDir  "$INSTDIR"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP_ID}"
SectionEnd
