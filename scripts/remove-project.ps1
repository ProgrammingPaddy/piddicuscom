<#
.SYNOPSIS
    Unmount a project from the site.

.DESCRIPTION
    Removes the submodule under projects/<slug>, cleans up git's internal
    module storage, and drops the entry from projects/projects.json.

    Nothing is committed. Review the staged changes and commit them yourself.

.PARAMETER Slug
    The project's folder name under projects/.

.EXAMPLE
    .\scripts\remove-project.ps1 -Slug snake
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory)]
    [string] $Slug
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "Manifest.psm1") -Force

$manifest = Get-Manifest
$relativePath = "projects/$Slug"

Push-Location (Get-RepoRoot)
try {
    if (Test-Path $relativePath) {
        Write-Host "Removing submodule $relativePath ..." -ForegroundColor Cyan
        & git submodule deinit -f -- $relativePath
        & git rm -f -- $relativePath
        if ($LASTEXITCODE -ne 0) {
            throw "git rm failed."
        }
    }
    else {
        Write-Warning "Folder '$relativePath' does not exist; only cleaning the manifest."
    }

    $moduleStore = Join-Path ".git\modules" $relativePath
    if (Test-Path $moduleStore) {
        Remove-Item -Recurse -Force $moduleStore
    }

    # git rm leaves an empty .gitmodules behind once the last submodule goes.
    if ((Test-Path ".gitmodules") -and -not (Select-String -Path ".gitmodules" -Pattern '^\[submodule' -Quiet)) {
        & git rm -q -f --cached -- .gitmodules 2>$null
        Remove-Item -Force ".gitmodules"
    }

    $remaining = @($manifest.projects | Where-Object { $_.slug -ne $Slug })
    if ($remaining.Count -eq $manifest.projects.Count) {
        Write-Warning "No manifest entry for '$Slug'."
    }
    else {
        $manifest.projects = $remaining
        Save-Manifest $manifest
        & git add "projects/projects.json"
    }

    Write-Host ""
    Write-Host "Removed '$Slug'." -ForegroundColor Green
    Write-Host "Review with 'git status' and commit when ready."
}
finally {
    Pop-Location
}
