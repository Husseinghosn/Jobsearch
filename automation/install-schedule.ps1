<#
.SYNOPSIS
  Registers the two scheduled tasks for the current user (no admin needed):
    \career-ops\daily            every day at -DailyAt       -> automation\daily.ps1
    \career-ops\followup-sweep   Mon + Thu at -FollowupAt     -> scripts/followup-sweep.sh (drafts only, never sends)

.DESCRIPTION
  Tasks run "only when the user is logged on" with normal (not highest) privileges, so you
  can edit or delete them later without an elevated shell (docs/WINDOWS.md 7).
  -StartWhenAvailable means a run missed while the PC was asleep or off starts at the next logon/wake.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File automation\install-schedule.ps1
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File automation\install-schedule.ps1 -DailyAt 06:50 -MaxEvaluations 10
#>
[CmdletBinding()]
param(
    [string]$DailyAt = '07:40',
    [string]$FollowupAt = '08:10',
    [ValidateRange(1, 100)][int]$MaxEvaluations = 15,
    [switch]$NoFollowupSweep
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

$Repo = Get-RepoRoot
$NodeExe = Resolve-NodeExe
$BashExe = Resolve-GitBash
$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
    Write-Warning 'claude (Claude Code CLI) is not on PATH. The rank, evaluate and follow-up steps need it: https://code.claude.com'
}

$TaskPath = '\career-ops\'
$user = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew

$dailyScript = Join-Path $Repo 'automation\daily.ps1'
$dailyArgs = ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Node "{1}" -Bash "{2}" -MaxEvaluations {3}' -f $dailyScript, $NodeExe, $BashExe, $MaxEvaluations)
$dailyAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $dailyArgs -WorkingDirectory $Repo
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
Register-ScheduledTask -TaskPath $TaskPath -TaskName 'daily' -Action $dailyAction -Trigger $dailyTrigger `
    -Principal $principal -Settings $settings -Force `
    -Description 'career-ops: scan, rank, evaluate the top postings, tailor CVs, write output\today.md. Never submits.' | Out-Null
Write-Host "Registered ${TaskPath}daily at $DailyAt (up to $MaxEvaluations evaluations/day)."

if (-not $NoFollowupSweep) {
    # followup-sweep.sh logs to data\followup-sweep.log itself, so the discarded console output is fine.
    $fuAction = New-ScheduledTaskAction -Execute $BashExe -Argument 'scripts/followup-sweep.sh' -WorkingDirectory $Repo
    $fuTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Thursday -At $FollowupAt
    Register-ScheduledTask -TaskPath $TaskPath -TaskName 'followup-sweep' -Action $fuAction -Trigger $fuTrigger `
        -Principal $principal -Settings $settings -Force `
        -Description 'career-ops: draft follow-up messages for aging applications into output\. Never sends.' | Out-Null
    Write-Host "Registered ${TaskPath}followup-sweep on Mon/Thu at $FollowupAt."
}

Write-Host ''
Write-Host 'Try it now:   Start-ScheduledTask -TaskPath ''\career-ops\'' -TaskName daily'
Write-Host 'Last result:  Get-ScheduledTaskInfo -TaskPath ''\career-ops\'' -TaskName daily'
Write-Host 'Remove:       powershell -ExecutionPolicy Bypass -File automation\uninstall-schedule.ps1'
