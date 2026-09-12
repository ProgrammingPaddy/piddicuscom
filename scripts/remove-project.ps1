<#
.SYNOPSIS
    Remove a project from the site.

.DESCRIPTION
    Deletes public/projects/<slug> and drops the entry from
    public/projects/projects.json.

    Nothing is committed. Review the staged changes and commit them yourself.

.PARAMETER Slug
    The project's folder name under public/projects.

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
$relativePath = Get-ProjectRelativePath $Slug
$absolutePath = Join-Path (Get-ProjectsDir) $Slug

Push-Location (Get-RepoRoot)
try {
    if (Test-Path $absolutePath) {
        Write-Host "Removing $relativePath ..." -ForegroundColor Cyan

        $tracked = & git ls-files -- $relativePath
        if ($tracked) {
            & git rm -r -q -f -- $relativePath
            if ($LASTEXITCODE -ne 0) {
                throw "git rm failed."
            }
        }

        # Catch anything git rm did not know about (untracked files).
        if (Test-Path $absolutePath) {
            Remove-Item -Recurse -Force $absolutePath
        }
    }
    else {
        Write-Warning "Folder '$relativePath' does not exist; only cleaning the manifest."
    }

    $remaining = @($manifest.projects | Where-Object { $_.slug -ne $Slug })
    if ($remaining.Count -eq $manifest.projects.Count) {
        Write-Warning "No manifest entry for '$Slug'."
    }
    else {
        $manifest.projects = $remaining
        Save-Manifest $manifest
        & git add -- "public/projects/projects.json"
    }

    Write-Host ""
    Write-Host "Removed '$Slug'." -ForegroundColor Green
    Write-Host "Review with 'git status' and commit when ready."
}
finally {
    Pop-Location
}
