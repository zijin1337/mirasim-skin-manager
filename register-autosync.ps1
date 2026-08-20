# Register the scheduled task that re-applies the skin manager after a Mirasim
# app update. Idempotent — re-run to update the task definition.
#   powershell -ExecutionPolicy Bypass -File register-autosync.ps1
# Remove with:  Unregister-ScheduledTask -TaskName "MirasimSkinAutoSync"
$vbs = Join-Path $PSScriptRoot "autosync-hidden.vbs"
$action  = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
$tLogon  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$tRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
             -RepetitionInterval (New-TimeSpan -Minutes 1)
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
         -StartWhenAvailable -MultipleInstances IgnoreNew `
         -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "MirasimSkinAutoSync" -Action $action `
  -Trigger $tLogon,$tRepeat -Settings $set -Force `
  -Description "Re-applies the Mirasim skin-manager loader after an app update (checks every minute; no-op when already installed)."
