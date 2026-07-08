Attribute VB_Name = "VBADataAccess"
Option Explicit

Private Const DATA_SHEET_NAME As String = "Data"
Private Const HEADER_ROW As Long = 1

Public Enum DataColumns
    dcId = 1
    dcName = 2
    dcCategory = 3
    dcAmount = 4
    dcDueDate = 5
    dcStatus = 6
End Enum

Public Function GetDataSheet() As Worksheet
    On Error GoTo MissingSheet
    Set GetDataSheet = ThisWorkbook.Worksheets(DATA_SHEET_NAME)
    Exit Function

MissingSheet:
    MsgBox "Sheet '" & DATA_SHEET_NAME & "' was not found.", vbCritical
    Set GetDataSheet = Nothing
End Function

Public Function GetNextDataRow(ByVal ws As Worksheet) As Long
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, dcId).End(xlUp).Row

    If lastRow < HEADER_ROW + 1 Then
        GetNextDataRow = HEADER_ROW + 1
    Else
        GetNextDataRow = lastRow + 1
    End If
End Function

Public Function FindRowById(ByVal ws As Worksheet, ByVal recordId As String) As Long
    Dim lastRow As Long
    Dim rowIndex As Long

    lastRow = ws.Cells(ws.Rows.Count, dcId).End(xlUp).Row
    FindRowById = 0

    For rowIndex = HEADER_ROW + 1 To lastRow
        If Trim$(CStr(ws.Cells(rowIndex, dcId).Value)) = Trim$(recordId) Then
            FindRowById = rowIndex
            Exit Function
        End If
    Next rowIndex
End Function

Public Function GenerateNextId(ByVal ws As Worksheet) As String
    Dim lastRow As Long
    Dim maxNumericId As Long
    Dim rowIndex As Long
    Dim candidate As String

    lastRow = ws.Cells(ws.Rows.Count, dcId).End(xlUp).Row
    maxNumericId = 0

    For rowIndex = HEADER_ROW + 1 To lastRow
        candidate = Trim$(CStr(ws.Cells(rowIndex, dcId).Value))
        If IsNumeric(candidate) Then
            If CLng(candidate) > maxNumericId Then
                maxNumericId = CLng(candidate)
            End If
        End If
    Next rowIndex

    GenerateNextId = CStr(maxNumericId + 1)
End Function

Public Sub AddRecord(ByVal name As String, ByVal category As String, ByVal amount As Double, ByVal dueDate As Date, ByVal status As String)
    Dim ws As Worksheet
    Dim nextRow As Long

    Set ws = GetDataSheet()
    If ws Is Nothing Then Exit Sub

    nextRow = GetNextDataRow(ws)
    ws.Cells(nextRow, dcId).Value = GenerateNextId(ws)
    ws.Cells(nextRow, dcName).Value = name
    ws.Cells(nextRow, dcCategory).Value = category
    ws.Cells(nextRow, dcAmount).Value = amount
    ws.Cells(nextRow, dcDueDate).Value = dueDate
    ws.Cells(nextRow, dcStatus).Value = status
End Sub

Public Function UpdateRecord(ByVal recordId As String, ByVal name As String, ByVal category As String, ByVal amount As Double, ByVal dueDate As Date, ByVal status As String) As Boolean
    Dim ws As Worksheet
    Dim rowIndex As Long

    Set ws = GetDataSheet()
    If ws Is Nothing Then
        UpdateRecord = False
        Exit Function
    End If

    rowIndex = FindRowById(ws, recordId)
    If rowIndex = 0 Then
        UpdateRecord = False
        Exit Function
    End If

    ws.Cells(rowIndex, dcName).Value = name
    ws.Cells(rowIndex, dcCategory).Value = category
    ws.Cells(rowIndex, dcAmount).Value = amount
    ws.Cells(rowIndex, dcDueDate).Value = dueDate
    ws.Cells(rowIndex, dcStatus).Value = status
    UpdateRecord = True
End Function

Public Function DeleteRecord(ByVal recordId As String) As Boolean
    Dim ws As Worksheet
    Dim rowIndex As Long

    Set ws = GetDataSheet()
    If ws Is Nothing Then
        DeleteRecord = False
        Exit Function
    End If

    rowIndex = FindRowById(ws, recordId)
    If rowIndex = 0 Then
        DeleteRecord = False
        Exit Function
    End If

    ws.Rows(rowIndex).Delete
    DeleteRecord = True
End Function

Public Function GetAllRecordsAsText() As String
    Dim ws As Worksheet
    Dim lastRow As Long
    Dim rowIndex As Long
    Dim outputText As String

    Set ws = GetDataSheet()
    If ws Is Nothing Then
        GetAllRecordsAsText = ""
        Exit Function
    End If

    lastRow = ws.Cells(ws.Rows.Count, dcId).End(xlUp).Row
    If lastRow < HEADER_ROW + 1 Then
        GetAllRecordsAsText = "No records found."
        Exit Function
    End If

    outputText = "ID | Name | Category | Amount | DueDate | Status" & vbCrLf
    outputText = outputText & String(65, "-") & vbCrLf

    For rowIndex = HEADER_ROW + 1 To lastRow
        outputText = outputText _
            & CStr(ws.Cells(rowIndex, dcId).Value) & " | " _
            & CStr(ws.Cells(rowIndex, dcName).Value) & " | " _
            & CStr(ws.Cells(rowIndex, dcCategory).Value) & " | " _
            & Format$(ws.Cells(rowIndex, dcAmount).Value, "0.00") & " | " _
            & Format$(ws.Cells(rowIndex, dcDueDate).Value, "yyyy-mm-dd") & " | " _
            & CStr(ws.Cells(rowIndex, dcStatus).Value) & vbCrLf
    Next rowIndex

    GetAllRecordsAsText = outputText
End Function
