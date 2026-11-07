<#
.SYNOPSIS
  Unattended daily career-ops run: scan -> rank -> select top N -> evaluate + tailor CVs -> digest.

.DESCRIPTION
  Fork-local (declared in config/local-paths.txt). Registered in Task Scheduler by
  automation\install-schedule.ps1; safe to run by hand at any time.

  Steps (each one is logged; a failing step is recorded and the run continues):
    1. update check     node update-system.mjs check            (notify only, never applies)
    2. scan             node scan.mjs --quiet --since N          (zero tokens, public ATS APIs)
    3. rank             node rank-pipeline.mjs --limit N         (small LLM call per posting)
    4. select           node automation/select-batch.mjs              (zero tokens; caps the evaluations)
    5. evaluate         Git Bash batch/batch-runner.sh --limit N (LLM; reports, tailored PDFs, tracker)
    6. digest           node automation/digest.mjs                    (zero tokens; output\today.md)
    7. backup           git commit + push of the data root, ONLY when the data root is its own
                        git repo outside this checkout (your private career-data repo)
    8. toast notification with the counts

  Nothing here submits an application or sends a message. career-ops cannot submit.

  Task Scheduler discards console output, so everything goes to
  <data root>\data\logs\daily-YYYY-MM-DD.log.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File automation\daily.ps1 -DryRun
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File automation\daily.ps1 -MaxEvaluations 2
#>
[CmdletBinding()]
param(
    [ValidateRange(0, 100)][int]$MaxEvaluations = 15,
    [ValidateRange(0, 200)][int]$RankLimit = 40,
    [ValidateRange(0.0, 5.0)][double]$MinRank = 3.5,
    [ValidateRange(1, 60)][int]$SinceDays = 7,
    [ValidateRange(1, 6)][int]$Parallel = 3,
    [switch]$DryRun,
    [switch]$NoToast,
    [switch]$NoBackup,
    [switch]$OpenDigest,
    [string]$Node = '',
    [string]$Bash = ''
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Continue'   # each step reports its own failure; one bad step must not hide the rest
. "$PSScriptRoot\common.ps1"

$Repo = Get-RepoRoot
Set-Location -LiteralPath $Repo
$script:Failures = New-Object System.Collections.Generic.List[string]
$script:Notices = New-Object System.Collections.Generic.List[string]
$script:Log = $null

function Write-Log {
    param([string]$Message)
    $line = '[{0:HH:mm:ss}] {1}' -f (Get-Date), $Message
    Write-Host $line
    if ($script:Log) { Add-Content -LiteralPath $script:Log -Value $line -Encoding UTF8 }
}

# Runs one step, streams its stdout+stderr into the log, records a non-zero exit.
# Returns the step's output lines so callers can parse them.
function Invoke-Step {
    param([string]$Name, [scriptblock]$Body, [int[]]$OkExitCodes = @(0))
    Write-Log "=== $Name"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $lines = New-Object System.Collections.Generic.List[string]
    $code = 0
    try {
        $global:LASTEXITCODE = 0
        & $Body 2>&1 | ForEach-Object {
            $text = "$_"
            $lines.Add($text)
            Write-Log "    $text"
        }
        $code = $global:LASTEXITCODE
    } catch {
        Write-Log "    ERROR: $($_.Exception.Message)"
        $code = -1
    }
    $sw.Stop()
    if ($OkExitCodes -notcontains $code) {
        $script:Failures.Add("$Name (exit $code)")
        Write-Log ("=== {0} FAILED (exit {1}, {2:N0}s)" -f $Name, $code, $sw.Elapsed.TotalSeconds)
    } else {
        Write-Log ("=== {0} ok ({1:N0}s)" -f $Name, $sw.Elapsed.TotalSeconds)
    }
    return , $lines.ToArray()
}

function Show-Toast {
    param([string]$Title, [string]$Text)
    if ($NoToast) { return }
    try {
        # WinRT toast API; available in Windows PowerShell 5.1 (the Task Scheduler host), not in pwsh 7.
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
        $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $xml.GetElementsByTagName('text')
        [void]$nodes.Item(0).AppendChild($xml.CreateTextNode($Title))
        [void]$nodes.Item(1).AppendChild($xml.CreateTextNode($Text))
        $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    } catch {
        Write-Log "    (toast unavailable: $($_.Exception.Message))"
    }
}

# --- Resolve tools and the data root -------------------------------------------------
try {
    $NodeExe = Resolve-NodeExe -Preferred $Node
    $BashExe = Resolve-GitBash -Preferred $Bash
} catch {
    Write-Host "daily.ps1: $($_.Exception.Message)"
    Show-Toast 'career-ops: setup problem' $_.Exception.Message
    exit 1
}

$DataRoot = (& $NodeExe --input-type=module -e "import { getCareerOpsRoot } from './path-resolver.mjs'; process.stdout.write(getCareerOpsRoot())")
if (-not $DataRoot) { $DataRoot = $Repo }
$LogDir = Join-Path $DataRoot 'data\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$script:Log = Join-Path $LogDir ('daily-{0:yyyy-MM-dd}.log' -f (Get-Date))

Write-Log ("career-ops daily run{0}" -f $(if ($DryRun) { ' (DRY RUN: no tokens spent, nothing written)' } else { '' }))
Write-Log "repo=$Repo dataRoot=$DataRoot node=$NodeExe bash=$BashExe"

# Onboarding must be finished first, otherwise every step fails noisily.
$doctor = (& $NodeExe doctor.mjs --json) -join "`n"
try { $doctorJson = $doctor | ConvertFrom-Json } catch { $doctorJson = $null }
if ($doctorJson -and $doctorJson.onboardingNeeded) {
    $missing = ($doctorJson.missing -join ', ')
    Write-Log "Onboarding not finished (missing: $missing). Run 'claude' in this folder and type /career-ops first."
    Show-Toast 'career-ops: finish onboarding' "Missing: $missing"
    exit 1
}

# --- 1. Update check (notify only) ------------------------------------------------------
$upd = Invoke-Step 'update check' { & $NodeExe update-system.mjs check }
$updText = $upd -join ' '
if ($updText -match '"status"\s*:\s*"update-available"') { $script:Notices.Add('career-ops update available: npm run update') }

# --- 2. Scan ------------------------------------------------------------------------------
$scanArgs = @('scan.mjs', '--quiet', '--since', "$SinceDays")
if ($DryRun) { $scanArgs += '--dry-run' }
[void](Invoke-Step 'scan' { & $NodeExe @scanArgs })

# --- 3. Rank (LLM; skipped in a dry run) --------------------------------------------------
if (-not $DryRun -and $RankLimit -gt 0) {
    [void](Invoke-Step 'rank' { & $NodeExe rank-pipeline.mjs --limit $RankLimit })
} else {
    Write-Log '=== rank skipped (dry run or -RankLimit 0)'
}

# --- 4. Select the top postings for full evaluation ---------------------------------------
$minRankText = $MinRank.ToString([Globalization.CultureInfo]::InvariantCulture)   # '3.5', never '3,5'
$selArgs = @('automation/select-batch.mjs', '--min-rank', $minRankText, '--max', "$MaxEvaluations", '--json')
if ($DryRun) { $selArgs += '--dry-run' }
$sel = Invoke-Step 'select' { & $NodeExe @selArgs }
$queued = 0
try {
    $selJson = ($sel -join "`n") | ConvertFrom-Json
    $queued = @($selJson.queued).Count
    if ($selJson.unranked -gt 0 -and -not $DryRun) {
        $script:Notices.Add("$($selJson.unranked) posting(s) not ranked yet (rank step capped or failed)")
    }
} catch {
    Write-Log "    could not parse select output: $($_.Exception.Message)"
}

# --- 5. Evaluate + tailored CV PDFs + tracker (LLM) ---------------------------------------
# batch-runner.sh also merges tracker additions, reconciles the pipeline and verifies it.
$batchArgs = @('batch/batch-runner.sh', '--limit', "$MaxEvaluations", '--parallel', "$Parallel")
if ($DryRun) { $batchArgs += '--dry-run' }
if ($MaxEvaluations -gt 0) {
    [void](Invoke-Step 'evaluate' { & $BashExe @batchArgs })
} else {
    Write-Log '=== evaluate skipped (-MaxEvaluations 0)'
}

# --- 6. Digest ----------------------------------------------------------------------------
$digArgs = @('automation/digest.mjs')
if ($DryRun) { $digArgs += '--stdout' }   # dry run: print to the log, don't overwrite today.md
$dig = Invoke-Step 'digest' { & $NodeExe @digArgs }
$summary = ($dig | Where-Object { $_ -like 'Summary:*' } | Select-Object -Last 1)
$todayMd = Join-Path $DataRoot 'output\today.md'

# --- 7. Backup the data root (private repo) -------------------------------------------------
# Only when the data root is a separate git repo: never commit personal data into this code repo.
$dataIsOwnRepo = $false
if (Test-Path -LiteralPath (Join-Path $DataRoot '.git')) {
    $dataFull = (Resolve-Path -LiteralPath $DataRoot).Path.TrimEnd('\')
    $repoFull = (Resolve-Path -LiteralPath $Repo).Path.TrimEnd('\')
    $dataIsOwnRepo = ($dataFull -ne $repoFull)
}
if ($DryRun -or $NoBackup) {
    Write-Log '=== backup skipped (dry run or -NoBackup)'
} elseif (-not $dataIsOwnRepo) {
    Write-Log '=== backup skipped (data root is not its own git repo; see automation\README.md setup step 4)'
} elseif (-not (& git -C $DataRoot status --porcelain)) {
    Write-Log '=== backup: nothing changed'
} else {
    [void](Invoke-Step 'backup' {
        & git -C $DataRoot add -A
        # Same secret check docs/BACKUP_STRATEGIES.md recommends; exit 0 means a match was found.
        & git -C $DataRoot grep --cached -nE 'sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|PRIVATE KEY-----'
        if ($LASTEXITCODE -eq 0) {
            & git -C $DataRoot reset -q
            Write-Output 'Refusing to back up: a staged file looks like it contains an API key or private key (listed above).'
            $global:LASTEXITCODE = 3
            return
        }
        & git -C $DataRoot commit -q -m ('backup {0:yyyy-MM-dd}' -f (Get-Date))
        if ($LASTEXITCODE -eq 0) { & git -C $DataRoot push -q }
    })
}

# --- 8. Notify ----------------------------------------------------------------------------
if ($DryRun) { $body = 'Dry run finished (nothing written). Read the log for what would happen.' }
elseif ($summary) { $body = $summary -replace '^Summary:\s*', '' }
else { $body = 'Digest not written - see the log.' }
$body = "Queued $queued for evaluation. $body"
if ($script:Notices.Count) { $body = $body + ' | ' + ($script:Notices -join ' | ') }
if ($script:Failures.Count) {
    $body = 'FAILED: ' + ($script:Failures -join ', ') + '. ' + $body
    Write-Log ("Finished with failures: {0}. Log: {1}" -f ($script:Failures -join ', '), $script:Log)
} else {
    Write-Log "Finished OK. Digest: $todayMd"
}
Show-Toast 'career-ops: today''s job search' $body
if ($OpenDigest -and (Test-Path -LiteralPath $todayMd)) { Start-Process -FilePath $todayMd }

if ($script:Failures.Count) { exit 1 } else { exit 0 }
