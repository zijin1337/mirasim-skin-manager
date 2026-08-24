' Scheduled-task entry point, no console window.
' Fires the RESIDENT watcher: if one is already running it exits instantly
' (single-instance lock), so the every-minute task is a watchdog, not a poller.
Dim sh, here
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run """C:\Program Files\nodejs\node.exe"" """ & here & "\watch-and-heal.mjs""", 0, False
