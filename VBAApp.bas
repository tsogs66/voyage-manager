Attribute VB_Name = "VBAApp"
Option Explicit

Public Sub LaunchApp()
    Dim choice As String

    Do
        choice = InputBox( _
            "Excel VBA App Menu" & vbCrLf _
            & "1 - View all records" & vbCrLf _
            & "2 - Add record" & vbCrLf _
            & "3 - Edit record" & vbCrLf _
            & "4 - Delete record" & vbCrLf _
            & "5 - Exit", _
            "VBA Application")

        If choice = vbNullString Then Exit Do

        Select Case Trim$(choice)
            Case "1"
                ShowAllRecords
            Case "2"
                AddRecordFlow
            Case "3"
                EditRecordFlow
            Case "4"
                DeleteRecordFlow
            Case "5"
                Exit Do
            Case Else
                MsgBox "Invalid choice. Please select 1 to 5.", vbExclamation
        End Select
    Loop
End Sub

Private Sub ShowAllRecords()
    MsgBox GetAllRecordsAsText(), vbInformation, "All Records"
End Sub

Private Sub AddRecordFlow()
    Dim nameValue As String
    Dim categoryValue As String
    Dim amountText As String
    Dim dueDateText As String
    Dim statusValue As String
    Dim amountValue As Double
    Dim dueDateValue As Date

    nameValue = InputBox("Enter Name:", "Add Record")
    If Not IsNonEmptyText(nameValue) Then
        MsgBox "Name is required.", vbExclamation
        Exit Sub
    End If

    categoryValue = InputBox("Enter Category:", "Add Record")
    If Not IsNonEmptyText(categoryValue) Then
        MsgBox "Category is required.", vbExclamation
        Exit Sub
    End If

    amountText = InputBox("Enter Amount:", "Add Record")
    If Not TryParseDouble(amountText, amountValue) Then
        MsgBox "Amount must be a valid number.", vbExclamation
        Exit Sub
    End If

    dueDateText = InputBox("Enter Due Date (YYYY-MM-DD):", "Add Record")
    If Not TryParseDate(dueDateText, dueDateValue) Then
        MsgBox "DueDate must be a valid date.", vbExclamation
        Exit Sub
    End If

    statusValue = InputBox("Enter Status (New, In Progress, Done, Cancelled):", "Add Record")
    If Not IsValidStatus(statusValue) Then
        MsgBox "Status must be New, In Progress, Done, or Cancelled.", vbExclamation
        Exit Sub
    End If

    AddRecord nameValue, categoryValue, amountValue, dueDateValue, statusValue
    MsgBox "Record added successfully.", vbInformation
End Sub

Private Sub EditRecordFlow()
    Dim recordId As String
    Dim ws As Worksheet
    Dim rowIndex As Long
    Dim nameValue As String
    Dim categoryValue As String
    Dim amountText As String
    Dim dueDateText As String
    Dim statusValue As String
    Dim amountValue As Double
    Dim dueDateValue As Date

    Set ws = GetDataSheet()
    If ws Is Nothing Then Exit Sub

    recordId = InputBox("Enter Record ID to edit:", "Edit Record")
    If Not IsNonEmptyText(recordId) Then Exit Sub

    rowIndex = FindRowById(ws, recordId)
    If rowIndex = 0 Then
        MsgBox "Record ID not found.", vbExclamation
        Exit Sub
    End If

    nameValue = InputBox("Enter Name:", "Edit Record", CStr(ws.Cells(rowIndex, dcName).Value))
    If Not IsNonEmptyText(nameValue) Then
        MsgBox "Name is required.", vbExclamation
        Exit Sub
    End If

    categoryValue = InputBox("Enter Category:", "Edit Record", CStr(ws.Cells(rowIndex, dcCategory).Value))
    If Not IsNonEmptyText(categoryValue) Then
        MsgBox "Category is required.", vbExclamation
        Exit Sub
    End If

    amountText = InputBox("Enter Amount:", "Edit Record", CStr(ws.Cells(rowIndex, dcAmount).Value))
    If Not TryParseDouble(amountText, amountValue) Then
        MsgBox "Amount must be a valid number.", vbExclamation
        Exit Sub
    End If

    dueDateText = InputBox("Enter Due Date (YYYY-MM-DD):", "Edit Record", CStr(ws.Cells(rowIndex, dcDueDate).Value))
    If Not TryParseDate(dueDateText, dueDateValue) Then
        MsgBox "DueDate must be a valid date.", vbExclamation
        Exit Sub
    End If

    statusValue = InputBox("Enter Status (New, In Progress, Done, Cancelled):", "Edit Record", CStr(ws.Cells(rowIndex, dcStatus).Value))
    If Not IsValidStatus(statusValue) Then
        MsgBox "Status must be New, In Progress, Done, or Cancelled.", vbExclamation
        Exit Sub
    End If

    If UpdateRecord(recordId, nameValue, categoryValue, amountValue, dueDateValue, statusValue) Then
        MsgBox "Record updated successfully.", vbInformation
    Else
        MsgBox "Failed to update record.", vbCritical
    End If
End Sub

Private Sub DeleteRecordFlow()
    Dim recordId As String
    Dim confirmed As VbMsgBoxResult

    recordId = InputBox("Enter Record ID to delete:", "Delete Record")
    If Not IsNonEmptyText(recordId) Then Exit Sub

    confirmed = MsgBox("Delete record ID " & recordId & "?", vbYesNo + vbQuestion, "Confirm Delete")
    If confirmed <> vbYes Then Exit Sub

    If DeleteRecord(recordId) Then
        MsgBox "Record deleted.", vbInformation
    Else
        MsgBox "Record ID not found.", vbExclamation
    End If
End Sub
