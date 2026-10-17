Option Explicit
Dim files, shell, project, script, node, command, result, fallback
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
project = files.GetParentFolderName(WScript.ScriptFullName)
script = files.BuildPath(project, "src\native\launch.mjs")
node = "node.exe"
If WScript.Arguments.Count > 0 Then
  If files.FileExists(WScript.Arguments(0)) Then node = WScript.Arguments(0)
End If
shell.CurrentDirectory = project
command = Chr(34) & node & Chr(34) & " " & Chr(34) & script & Chr(34)
fallback = "explorer.exe shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number = 0 And result = 3 Then
  shell.Popup "Codex is already running without the thinking viewer. Close Codex normally once, then open it from the new Codex shortcut.", 0, "Codex Thinking Viewer", 64
ElseIf Err.Number <> 0 Or result <> 0 Then
  Err.Clear
  shell.Run fallback, 1, False
End If
