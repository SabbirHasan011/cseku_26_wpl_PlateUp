param(
    [string]$Branch,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-ProjectGit {
    param([string[]]$GitArguments)
    # Windows PowerShell treats native stderr as an error record even on success.
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& git --no-optional-locks @GitArguments 2>&1)
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($exitCode -ne 0) { throw ($output -join "`n") }
    return $output | ForEach-Object { $_.ToString() }
}

function Get-UnsafeTrackedPaths {
    param([string]$Reference)
    $files = @(Invoke-ProjectGit @('ls-tree', '-r', '--name-only', $Reference))
    return $files | Where-Object {
        ($_ -match '(^|/)node_modules/' -or
         $_ -match '(^|/)\.env($|\.)' -or
         $_ -match '^(server/uploads|coverage|dist|build)/') -and
        $_ -notmatch '(^|/)\.env\.example$'
    }
}

Push-Location -LiteralPath $projectRoot
try {
    if (Get-Process git -ErrorAction SilentlyContinue) {
        throw 'Git is already running. Let it finish, or cancel the stuck command in its original terminal. No process or lock was removed.'
    }
    foreach ($name in @('index.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
        $gitPath = Invoke-ProjectGit @('rev-parse', '--git-path', $name)
        if (Test-Path -LiteralPath $gitPath) {
            throw "Git has pending state ($name). Resolve it first; see docs/branch-switching.md. No lock was removed."
        }
    }

    if ($CheckOnly) {
        $unsafeBranches = @()
        foreach ($name in @(Invoke-ProjectGit @('for-each-ref', '--format=%(refname:short)', 'refs/heads'))) {
            $unsafe = @(Get-UnsafeTrackedPaths "refs/heads/$name")
            Write-Output "$name : $($unsafe.Count) tracked local/generated files"
            if ($unsafe.Count) { $unsafeBranches += $name }
        }
        if ($unsafeBranches.Count) { throw ('Branches need cleanup: ' + ($unsafeBranches -join ', ')) }
        Write-Output 'All local branch tips are clean of credentials and generated files.'
        return
    }

    if (-not $Branch -or $Branch.StartsWith('-')) { throw 'Usage: .\tools\switch-branch.ps1 08 (or -CheckOnly)' }
    $null = Invoke-ProjectGit @('check-ref-format', '--branch', $Branch)
    $null = Invoke-ProjectGit @('show-ref', '--verify', '--quiet', "refs/heads/$Branch")
    if (@(Get-UnsafeTrackedPaths "refs/heads/$Branch").Count) {
        throw 'The target branch tracks dependencies, credentials or generated output. Clean its tip first; the branch was not switched.'
    }
    $changes = @(Invoke-ProjectGit @('status', '--porcelain', '--untracked-files=no'))
    if ($changes.Count) { throw 'Save tracked changes with a commit or an intentional stash before switching. No changes were discarded.' }

    # Never force, auto-stash, remove files, or overwrite ignored credentials.
    Invoke-ProjectGit @('switch', '--no-guess', '--no-overwrite-ignore', '--', $Branch)
    Write-Output ('Current branch: ' + (Invoke-ProjectGit @('branch', '--show-current')))
} finally { Pop-Location }
