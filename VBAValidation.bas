Attribute VB_Name = "VBAValidation"
Option Explicit

Public Function IsNonEmptyText(ByVal value As String) As Boolean
    IsNonEmptyText = (Len(Trim$(value)) > 0)
End Function

Public Function TryParseDouble(ByVal value As String, ByRef parsedValue As Double) As Boolean
    On Error GoTo ParseFailed
    If Len(Trim$(value)) = 0 Then
        TryParseDouble = False
        Exit Function
    End If

    parsedValue = CDbl(value)
    TryParseDouble = True
    Exit Function

ParseFailed:
    TryParseDouble = False
End Function

Public Function TryParseDate(ByVal value As String, ByRef parsedValue As Date) As Boolean
    On Error GoTo ParseFailed
    If Len(Trim$(value)) = 0 Then
        TryParseDate = False
        Exit Function
    End If

    parsedValue = CDate(value)
    TryParseDate = True
    Exit Function

ParseFailed:
    TryParseDate = False
End Function

Public Function IsValidStatus(ByVal value As String) As Boolean
    Dim normalized As String
    normalized = UCase$(Trim$(value))

    IsValidStatus = (normalized = "NEW" _
        Or normalized = "IN PROGRESS" _
        Or normalized = "DONE" _
        Or normalized = "CANCELLED")
End Function
