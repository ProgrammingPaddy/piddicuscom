<#
.SYNOPSIS
    Mount an external git repository as a project on the site.

.DESCRIPTION
    Adds the repository as a git submodule under projects/<slug> and appends
    an entry to projects/projects.json so it shows up on the homepage menu.

    Nothing is committed. Review the staged changes and commit them yourself.

.PARAMETER Url
    Clone URL of the project repository.

.PARAMETER Title
    Display name shown on the card.

.PARAMETER Slug
    Folder name under projects/. Defaults to a slugified Title.

.PARAMETER Description
    One or two sentences shown on the card.

.PARAMETER Icon
    Short string (usually an emoji) shown in the card's icon box.

.PARAMETER Tags
    Tags used for the homepage filter chips.

.PARAMETER Entry
    Path to the project's entry page, relative to its repo root.

.PARAMETER Branch
    Branch to track when running update-projects.ps1. Defaults to the
    repository's default branch.

.EXAMPLE
    .\scripts\add-project.ps1 -Url https://github.com/you/snake.git -Title "Snake" -Description "Classic snake in canvas." -Icon "🐍" -Tags game,canvas
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory)]
    [string] $Url,

    [Parameter(Mandatory)]
    [string] $Title,

    [string] $Slug,

    [string] $Description = "",

    [string] $Icon = "",

    [string[]] $Tags = @(),

    [string] $Entry = "index.html",

    [string] $Branch
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "Manifest.psm1") -Force

if (-not $Slug) {
    $Slug = ConvertTo-Slug $Title
}

if (-not (Test-Slug $Slug)) {
    throw "Slug '$Slug' must be lowercase letters, digits and single hyphens."
}

$manifest = Get-Manifest

if ($manifest.projects | Where-Object { $_.slug -eq $Slug }) {
    throw "A project with slug '$Slug' is already in the manifest."
}

$relativePath = "projects/$Slug"
$absolutePath = Join-Path (Get-ProjectsDir) $Slug

if (Test-Path $absolutePath) {
    throw "Folder '$relativePath' already exists."
}

Push-Location (Get-RepoRoot)
try {
    $submoduleArgs = @("submodule", "add")
    if ($Branch) {
        $submoduleArgs += @("-b", $Branch)
    }
    $submoduleArgs += @("--", $Url, $relativePath)

    Write-Host "Adding submodule $relativePath ..." -ForegroundColor Cyan
    & git @submoduleArgs
    if ($LASTEXITCODE -ne 0) {
        throw "git submodule add failed."
    }

    $entryPath = Join-Path $absolutePath $Entry
    if (-not (Test-Path $entryPath)) {
        Write-Warning "Entry page '$Entry' was not found in the cloned repo. The card will link to a missing page until you fix -Entry."
    }

    $project = [ordered]@{
        slug        = $Slug
        title       = $Title
        description = $Description
        icon        = $Icon
        tags        = @($Tags)
        entry       = $Entry
        repo        = $Url
    }

    $manifest.projects = @($manifest.projects) + [pscustomobject]$project
    Save-Manifest $manifest

    & git add "projects/projects.json"

    Write-Host ""
    Write-Host "Added '$Title' at $relativePath." -ForegroundColor Green
    Write-Host "Staged: .gitmodules, $relativePath, projects/projects.json"
    Write-Host "Review with 'git status' and commit when ready."
}
finally {
    Pop-Location
}
