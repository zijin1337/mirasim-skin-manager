' Run autosync.mjs with no console window (scheduled-task entry point).
Dim sh, here
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run """C:\Program Files\nodejs\node.exe"" """ & here & "\autosync.mjs""", 0, False
