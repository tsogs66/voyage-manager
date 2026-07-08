# AGENTS.md

## Cursor Cloud specific instructions

### What this project is
This repo is an **Excel VBA application** shipped as importable `.bas` modules
(`VBADataAccess.bas`, `VBAValidation.bas`, `VBAApp.bas`). There is no compiler,
package manager, lockfile, or test framework — the intended target is Microsoft
Excel on Windows (see `README.md`). `VBAApp.LaunchApp` is the interactive entry
point (InputBox/MsgBox menu for CRUD on a sheet named `Data`).

### How the app is run/tested on Linux (no Excel available)
The dev environment uses **LibreOffice** (`libreoffice-calc` + `python3-uno`) in
VBA-compatibility mode to actually execute the modules. `soffice` and the UNO
Python bridge are already installed in the environment.

- **Automated smoke test / "run the app" headlessly:** `python3 scripts/run_vba_smoke_test.py`
  builds a `Data` workbook, injects the `.bas` modules, runs a full add/view/update/delete
  flow, prints results, and writes `/tmp/voyage_manager_demo.xlsm`. Exit code 0 = pass.
- **Interactive GUI run:** open a `.ods` workbook that contains the modules in
  LibreOffice Calc, enable macros, then `Tools > Macros > Run Macro... > <doc> >
  VBAProject > VBAApp > LaunchApp`.
- **Lint:** there is no VBA linter configured in this repo.

### Non-obvious gotchas (important)
- **VBA compat must be enabled explicitly.** When building a workbook via UNO, set
  `doc.BasicLibraries.VBACompatibilityMode = True` *before* running macros, otherwise
  the Excel object model (`ThisWorkbook`, `Range.End(xlUp)`, `xl*` constants) is not wired.
  Note this flag lives on `BasicLibraries`, not on the document model.
- **`Range.End(xlUp)` needs a document controller.** Load the doc with `Hidden = False`
  (headless mode still works and has no display, but a controller must exist). A `Hidden`
  document makes `.End(...)` throw, which silently aborts the macros and yields empty results.
- **Strip `Attribute VB_Name = ...` lines** from `.bas` files before inserting them into a
  LibreOffice Basic library; the Basic engine does not understand them. Also prefix each
  module with `Option VBASupport 1`.
- **Saving to `.xlsm` does NOT preserve the Basic project** (the reopened file is data-only).
  To persist macros + the VBA compat flag for a GUI run, save as **`.ods`** (`calc8` filter)
  instead — reopening an `.ods` keeps both the modules and `VBACompatibilityMode`.
- The smoke-test script binds UNO on `127.0.0.1:2002` with a dedicated profile under
  `/tmp/lo_vba_profile`; don't run two copies at once.
