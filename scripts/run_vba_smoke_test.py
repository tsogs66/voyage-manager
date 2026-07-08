#!/usr/bin/env python3
"""Headless smoke test for the Excel VBA modules using LibreOffice + UNO.

Because Microsoft Excel is Windows-only, this script uses LibreOffice's VBA
compatibility mode to actually execute the .bas modules on Linux. It:

  1. Launches LibreOffice headless with a UNO socket.
  2. Creates a Calc document with a "Data" sheet (headers in row 1).
  3. Injects the repository's .bas modules into the document's Basic library
     (prefixed with `Option VBASupport 1` so VBA APIs like ThisWorkbook,
     Worksheets, Cells, xlUp, etc. resolve).
  4. Injects a small test-harness module and runs a full CRUD flow
     (add / view / update / delete) against the "Data" sheet.
  5. Prints the result and saves the workbook as an .xlsm for inspection.

This is a development/CI helper, not part of the shipped VBA app. The shipped
entry point (VBAApp.LaunchApp) is interactive (InputBox/MsgBox) and is meant to
be run inside Excel; this harness exercises the same underlying data-access and
validation logic non-interactively.
"""
import os
import subprocess
import sys
import time
import uno
from com.sun.star.beans import PropertyValue

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULES = ["VBADataAccess", "VBAValidation", "VBAApp"]
PROFILE_DIR = "/tmp/lo_vba_profile"
CONNECT = "socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext"


def strip_attribute_lines(src: str) -> str:
    """LibreOffice Basic does not understand `Attribute VB_Name = ...` lines."""
    lines = [ln for ln in src.splitlines() if not ln.strip().startswith("Attribute ")]
    return "\n".join(lines)


def read_module(name: str) -> str:
    with open(os.path.join(REPO_ROOT, name + ".bas"), "r", encoding="utf-8") as fh:
        return "Option VBASupport 1\n" + strip_attribute_lines(fh.read())


TEST_HARNESS = """Option VBASupport 1
Option Explicit

Public Function RunSmokeTest() As String
    Dim result As String

    AddRecord "Voyage Alpha", "Ocean", 1200.5, CDate("2026-08-01"), "New"
    AddRecord "Voyage Beta", "Air", 300, CDate("2026-09-15"), "In Progress"
    AddRecord "Voyage Gamma", "Rail", 75.25, CDate("2026-10-05"), "Done"

    result = "== After 3 adds ==" & Chr(10) & GetAllRecordsAsText() & Chr(10)

    If UpdateRecord("1", "Voyage Alpha (edited)", "Ocean", 1500, CDate("2026-08-10"), "Done") Then
        result = result & "UpdateRecord(1) -> OK" & Chr(10)
    Else
        result = result & "UpdateRecord(1) -> FAILED" & Chr(10)
    End If

    If DeleteRecord("2") Then
        result = result & "DeleteRecord(2) -> OK" & Chr(10)
    Else
        result = result & "DeleteRecord(2) -> FAILED" & Chr(10)
    End If

    result = result & Chr(10) & "== Final state ==" & Chr(10) & GetAllRecordsAsText()

    ' Exercise validation helpers too
    result = result & Chr(10) & Chr(10) & "== Validation checks =="
    result = result & Chr(10) & "IsValidStatus('Done') = " & IsValidStatus("Done")
    result = result & Chr(10) & "IsValidStatus('Bogus') = " & IsValidStatus("Bogus")
    result = result & Chr(10) & "IsNonEmptyText('  ') = " & IsNonEmptyText("  ")

    RunSmokeTest = result
End Function
"""


def make_prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def connect(ctx_local):
    resolver = ctx_local.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", ctx_local)
    last_err = None
    for _ in range(60):
        try:
            return resolver.resolve("uno:" + CONNECT)
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1)
    raise RuntimeError("Could not connect to LibreOffice: %s" % last_err)


def main():
    env = dict(os.environ)
    proc = subprocess.Popen([
        "soffice",
        "--headless",
        "--invisible",
        "--norestore",
        "--nologo",
        "--nofirststartwizard",
        "-env:UserInstallation=file://" + PROFILE_DIR,
        "--accept=" + CONNECT,
    ], env=env)

    try:
        local_ctx = uno.getComponentContext()
        ctx = connect(local_ctx)
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext(
            "com.sun.star.frame.Desktop", ctx)

        lib_name = "VBAProject"
        out_path = "/tmp/voyage_manager_demo.xlsm"
        url = "file://" + out_path

        # NOTE: the doc must NOT be Hidden -- LibreOffice's VBA Range.End(xlUp)
        # implementation requires a document controller/view to exist.
        doc = desktop.loadComponentFromURL(
            "private:factory/scalc", "_blank", 0,
            (make_prop("Hidden", False),))

        sheet = doc.Sheets.getByIndex(0)
        sheet.Name = "Data"
        headers = ["ID", "Name", "Category", "Amount", "DueDate", "Status"]
        for col, h in enumerate(headers):
            sheet.getCellByPosition(col, 0).setString(h)

        libs = doc.BasicLibraries
        # Enable VBA compatibility mode so the Excel object model
        # (ThisWorkbook, Range.End(xlUp), xlUp constants, etc.) is fully wired.
        libs.VBACompatibilityMode = True
        if libs.hasByName(lib_name):
            libs.removeLibrary(lib_name)
        libs.createLibrary(lib_name)
        lib = libs.getByName(lib_name)
        for name in MODULES:
            lib.insertByName(name, read_module(name))
        lib.insertByName("TestHarness", TEST_HARNESS)

        sp = doc.getScriptProvider()
        uri = ("vnd.sun.star.script:%s.TestHarness.RunSmokeTest"
               "?language=Basic&location=document" % lib_name)
        script = sp.getScript(uri)
        result, _, _ = script.invoke((), (), ())

        print("\n" + "=" * 60)
        print(result)
        print("=" * 60)

        print("\n== Raw Data sheet dump ==")
        for r in range(5):
            row_vals = [sheet.getCellByPosition(c, r).getString() for c in range(6)]
            if any(v for v in row_vals):
                print(" | ".join(row_vals))

        doc.storeToURL(url, (make_prop("FilterName", "Calc MS Excel 2007 XML"),))
        print("\nSaved demo workbook to: %s" % out_path)
        doc.close(False)

        if "Voyage Alpha (edited)" not in result or "Voyage Beta" in result.split("Final state")[-1]:
            print("\nSMOKE TEST FAILED: unexpected CRUD results")
            return 1
        print("\nSMOKE TEST PASSED")
    finally:
        try:
            desktop.terminate()
        except Exception:  # noqa: BLE001
            pass
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except Exception:  # noqa: BLE001
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
