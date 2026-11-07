<#
.SYNOPSIS
  Removes the scheduled tasks created by automation\install-schedule.ps1. Touches nothing else.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
foreach ($name in @('daily', 'followup-sweep')) {
    $task = Get-ScheduledTask -TaskPath '\career-ops\' -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskPath '\career-ops\' -TaskName $name -Confirm:$false
        Write-Host "Removed \career-ops\$name"
    } else {
        Write-Host "\career-ops\$name was not registered"
    }
}
