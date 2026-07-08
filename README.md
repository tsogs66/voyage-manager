# voyage-manager

Excel VBA application template for managing records in a worksheet.

## What this provides

This repository now includes a VBA-based application skeleton you can import into an `.xlsm` workbook:

- `VBADataAccess.bas`: read, add, update, delete records from sheet data
- `VBAValidation.bas`: input validation helpers
- `VBAApp.bas`: app entry points and user interaction flow

The app assumes your workbook has a table-like sheet where row 1 contains headers.

## Expected worksheet structure

Create a worksheet named `Data` with headers in row 1:

1. `ID`
2. `Name`
3. `Category`
4. `Amount`
5. `DueDate`
6. `Status`

You can rename columns later by editing constants in `VBADataAccess.bas`.

## How to run in Excel

1. Open Excel and save workbook as **Excel Macro-Enabled Workbook (`.xlsm`)**.
2. Press `ALT + F11` to open VBA editor.
3. Right-click your VBA project > `Import File...` and import:
   - `VBADataAccess.bas`
   - `VBAValidation.bas`
   - `VBAApp.bas`
4. Ensure macros are enabled.
5. Run macro `LaunchApp` from `VBAApp`.

## Available actions in the app menu

- View all records
- Add a record
- Edit a record by ID
- Delete a record by ID
- Exit

## Notes

- This template uses `InputBox` prompts so it works without building forms first.
- If you share your exact Excel columns/business logic, this can be customized into a fully tailored app flow.
