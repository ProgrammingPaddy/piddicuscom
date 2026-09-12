<#
.SYNOPSIS
    Pull the latest commit for one or all mounted projects.

.DESCRIPTION
    Runs `git submodule update --remote` so each project submodule points at
    the newest commit on its tracked branch, then stages the new pointers.

    Nothing is committed. Review the staged changes and commit them yourself.

.PARAMETER Slug
    Update only this project. Omit to update every project.

.EXAMPLE
    .\scripts\update-projects.ps1

.EXAMPLE
    .\scripts\update-projects.ps1 -Slug snake
#>

[CmdletBinding()]
param (
    [string] $Slug
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "Manifest.psm1") -Force

$manifest = Get-Manifest

if ($Slug) {
    $targets = @($manifest.projects | Where-Object { $_.slug -eq $Slug })
    if ($targets.Count -eq 0) {
        throw "No project with slug '$Slug' in the manifest."
    }
}
else {
    $targets = @($manifest.projects)
}

if ($targets.Count -eq 0) {
    Write-Host "No projects to update."
    return
}

Push-Location (Get-RepoRoot)
try {
    # Make sure freshly cloned checkouts have the submodules populated.
    & git submodule init | Out-Null

    foreach ($project in $targets) {
        $path = "projects/$($project.slug)"
        $before = (& git -C $path rev-parse --short HEAD 2>$null)

        Write-Host "Updating $path ..." -ForegroundColor Cyan
        & git submodule update --remote --merge -- $path
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Update failed for $path."
            continue
        }

        $after = (& git -C $path rev-parse --short HEAD)

        if ($before -eq $after) {
            Write-Host "  already at $after"
        }
        else {
            Write-Host "  $before -> $after" -ForegroundColor Green
            & git add -- $path
        }
    }

    Write-Host ""
    Write-Host "Review with 'git status' and commit when ready."
}
finally {
    Pop-Location
}
