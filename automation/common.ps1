# automation/common.ps1 -- helpers shared by daily.ps1 and install-schedule.ps1.
# Dot-source it: . "$PSScriptRoot\common.ps1"
# Written for Windows PowerShell 5.1 (the version Task Scheduler runs), so no
# ternaries, no ?? and no && -- those need PowerShell 7.

function Resolve-NodeExe {
    param([string]$Preferred = '')
    if ($Preferred -and (Test-Path -LiteralPath $Preferred)) { return (Resolve-Path -LiteralPath $Preferred).Path }
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'node.exe not found. Install Node.js 22.13+ (https://nodejs.org) and reopen PowerShell.'
}

# Git Bash, never the WSL launcher. On a default Windows install `bash` on PATH
# is C:\Windows\System32\bash.exe (WSL), which cannot see the Windows node.exe,
# so batch-runner.sh dies with "node: command not found" (docs/WINDOWS.md 1).
function Resolve-GitBash {
    param([string]$Preferred = '')
    $candidates = @()
    if ($Preferred) { $candidates += $Preferred }
    if ($env:CAREER_OPS_BASH) { $candidates += $env:CAREER_OPS_BASH }
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        # ...\Git\cmd\git.exe or ...\Git\bin\git.exe -> ...\Git\bin\bash.exe
        $gitRoot = Split-Path -Parent (Split-Path -Parent $git.Source)
        $candidates += (Join-Path $gitRoot 'bin\bash.exe')
    }
    $candidates += (Join-Path $env:ProgramFiles 'Git\bin\bash.exe')
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe') }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe') }
    if ($env:SCOOP) { $candidates += (Join-Path $env:SCOOP 'apps\git\current\bin\bash.exe') }
    $candidates += (Join-Path $env:USERPROFILE 'scoop\apps\git\current\bin\bash.exe')

    foreach ($c in $candidates) {
        if (-not $c) { continue }
        if ($c -match '\\System32\\') { continue }   # WSL launcher
        if (Test-Path -LiteralPath $c) { return (Resolve-Path -LiteralPath $c).Path }
    }
    throw 'Git Bash not found. Install Git for Windows (https://git-scm.com/download/win) or set CAREER_OPS_BASH to its bin\bash.exe.'
}

function Get-RepoRoot {
    return (Split-Path -Parent $PSScriptRoot)
}
