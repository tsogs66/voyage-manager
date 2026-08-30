Voyage Chief — portable (USB)
=============================

WHAT THIS IS
------------
The full Voyage Chief application in a folder you can copy. It does not
install: no Start menu, no Desktop shortcut, no registry, no administrator
rights. Put it on a USB stick, a shared drive, or a PC that is not yours,
and double-click "Start Voyage Chief.bat" (or run the portable .exe, which
unpacks this folder next to itself and starts).


STARTING IT
-----------
  1. Copy VoyageChief-Portable-*.exe onto the USB stick.
  2. Double-click it. A VoyageChief folder appears beside the .exe.
  3. Leave the small console window open while you work — that is the
     local server. Edge or Chrome opens http://127.0.0.1:8765 with a
     profile that lives on the stick.

Later visits: open the VoyageChief folder on the stick and double-click
"Start Voyage Chief.bat". You do not need the .exe again unless you want
to refresh the program files.


WHERE YOUR DATA IS
------------------
Voyage data (IndexedDB) is stored under this folder so the USB travels whole:

  VoyageChief\VoyageChief-data\browser-profile\

That profile is opened by Edge or Chrome with --user-data-dir. Take the
stick to another PC and the same voyages open again.

  - Edge or Chrome must be installed (Windows usually has Edge).
  - Do not use a private/incognito window from the system browser.
  - The installed copy under %LOCALAPPDATA%\NoonReport still uses the
    normal browser profile on that PC (unchanged).


UPDATING
--------
Copy a newer portable .exe onto the stick and run it. It overwrites the
program files in the VoyageChief folder and leaves VoyageChief-data alone.


REQUIREMENTS
------------
  - Windows 10 or 11
  - Windows PowerShell 5.1 (included with Windows)
  - Microsoft Edge or Google Chrome (for USB-side data)
  - The USB stick (or folder) must be writable on first run

No administrator rights are needed.
