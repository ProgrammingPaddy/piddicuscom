<#
.SYNOPSIS
    Refresh projects that came from a git repository.

.DESCRIPTION
    For each project with a "repo" in the manifest, fetches the latest commit
    on its tracked branch. If it differs from the recorded commit, the
    project's folder is replaced with the new files and the manifest is
    updated. Projects without a repo are edited in place and are skipped.

    Nothing is committed. Review the staged changes and commit them yourself.

.PARAMETER Slug
    Update only this project. Omit to update every repo-backed project.

.PARAMETER Force
    Re-copy the files even when the commit has not changed.

.EXAMPLE
    .\scripts\update-projects.ps1

.EXAMPLE
    .\scripts\update-projects.ps1 -Slug snake
#>

[CmdletBinding()]
param (
    [string] $Slug,

    [switch] $Force
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
    Write-Host "No projects in the manifest."
    return
}

$changed = $false

Push-Location (Get-RepoRoot)
try {
    foreach ($project in $targets) {
        $relativePath = Get-ProjectRelativePath $project.slug
        $absolutePath = Join-Path (Get-ProjectsDir) $project.slug

        if (-not $project.repo) {
            Write-Host "Skipping $relativePath (no repo; edit it in place)." -ForegroundColor DarkGray
            continue
        }

        Write-Host "Checking $relativePath ..." -ForegroundColor Cyan

        $tempClone = $null
        try {
            $remote = Get-RemoteProject -Url $project.repo -Branch $project.branch
            $tempClone = $remote.Path

            $before = if ($project.commit) { $project.commit.Substring(0, 7) } else { "none" }
            $after = $remote.Commit.Substring(0, 7)

            if ($remote.Commit -eq $project.commit -and -not $Force) {
                Write-Host "  already at $after"
                continue
            }

            Clear-Directory $absolutePath
            Copy-ProjectFiles -Source $remote.Path -Destination $absolutePath

            $project.commit = $remote.Commit
            $project.branch = $remote.Branch
            $changed = $true

            & git add -A -- $relativePath
            Write-Host "  $before -> $after" -ForegroundColor Green
        }
        catch {
            Write-Warning "Update failed for $relativePath : $_"
        }
        finally {
            if ($tempClone -and (Test-Path $tempClone)) {
                Remove-Item -Recurse -Force $tempClone
            }
        }
    }

    if ($changed) {
        Save-Manifest $manifest
        & git add -- "public/projects/projects.json"
        Write-Host ""
        Write-Host "Review with 'git status' and commit when ready."
    }
    else {
        Write-Host ""
        Write-Host "Everything is up to date."
    }
}
finally {
    Pop-Location
}
