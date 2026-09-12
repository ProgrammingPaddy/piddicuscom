<#
.SYNOPSIS
    Add a project to the site.

.DESCRIPTION
    Creates public/projects/<slug> and appends an entry to
    public/projects/projects.json so the project shows up on the homepage.

    Where the files come from depends on which parameter you pass:

      -Url   Copy the files from a git repository (pinned to its latest commit;
             refresh later with update-projects.ps1).
      -Path  Copy the files from a local folder.
      none   Create an empty project with a starter index.html.

    Nothing is committed. Review the staged changes and commit them yourself.

.PARAMETER Title
    Display name shown on the card.

.PARAMETER Url
    Clone URL of the project's repository.

.PARAMETER Path
    Local folder containing the project's files.

.PARAMETER Slug
    Folder name under public/projects. Defaults to a slugified Title.

.PARAMETER Description
    One or two sentences shown on the card.

.PARAMETER Icon
    Short string (usually an emoji) shown in the card's icon box.

.PARAMETER Tags
    Tags used for the homepage filter chips.

.PARAMETER Entry
    The project's entry page, relative to its folder.

.PARAMETER Branch
    Branch to copy from and track when using -Url. Defaults to the repo's
    default branch.

.EXAMPLE
    .\scripts\add-project.ps1 -Title "Snake" -Url https://github.com/you/snake.git -Icon "🐍" -Tags game

.EXAMPLE
    .\scripts\add-project.ps1 -Title "Colour Mixer" -Path ..\colour-mixer -Tags tool

.EXAMPLE
    .\scripts\add-project.ps1 -Title "Scratch Pad"
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory)]
    [string] $Title,

    [string] $Url,

    [string] $Path,

    [string] $Slug,

    [string] $Description = "",

    [string] $Icon = "",

    [string[]] $Tags = @(),

    [string] $Entry = "index.html",

    [string] $Branch
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "Manifest.psm1") -Force

if ($Url -and $Path) {
    throw "Pass either -Url or -Path, not both."
}

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

$relativePath = Get-ProjectRelativePath $Slug
$absolutePath = Join-Path (Get-ProjectsDir) $Slug

if (Test-Path $absolutePath) {
    throw "Folder '$relativePath' already exists."
}

$repo = $null
$trackedBranch = $null
$commit = $null
$tempClone = $null

Push-Location (Get-RepoRoot)
try {
    if ($Url) {
        Write-Host "Fetching $Url ..." -ForegroundColor Cyan
        $remote = Get-RemoteProject -Url $Url -Branch $Branch
        $tempClone = $remote.Path
        Copy-ProjectFiles -Source $remote.Path -Destination $absolutePath

        $repo = $Url
        $trackedBranch = $remote.Branch
        $commit = $remote.Commit
        Write-Host "  copied commit $($commit.Substring(0, 7)) from branch $trackedBranch"
    }
    elseif ($Path) {
        if (-not (Test-Path $Path -PathType Container)) {
            throw "Folder '$Path' does not exist."
        }
        Write-Host "Copying from $Path ..." -ForegroundColor Cyan
        Copy-ProjectFiles -Source (Resolve-Path $Path) -Destination $absolutePath
    }
    else {
        Write-Host "Creating empty project ..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Path $absolutePath | Out-Null

        $starter = @(
            "<!DOCTYPE html>",
            "<html lang=`"en`">",
            "<head>",
            "    <meta charset=`"UTF-8`">",
            "    <meta name=`"viewport`" content=`"width=device-width, initial-scale=1.0`">",
            "    <title>$Title</title>",
            "</head>",
            "<body>",
            "    <h1>$Title</h1>",
            "    <p><a href=`"../../`">Back to Piddicus</a></p>",
            "</body>",
            "</html>"
        ) -join "`n"

        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText((Join-Path $absolutePath "index.html"), $starter + "`n", $utf8NoBom)
    }

    if (-not (Test-Path (Join-Path $absolutePath $Entry))) {
        Write-Warning "Entry page '$Entry' was not found in the project. The card will link to a missing page until you fix -Entry."
    }

    $project = [ordered]@{
        slug        = $Slug
        title       = $Title
        description = $Description
        icon        = $Icon
        tags        = @($Tags)
        entry       = $Entry
        repo        = $repo
        branch      = $trackedBranch
        commit      = $commit
    }

    $manifest.projects = @($manifest.projects) + [pscustomobject]$project
    Save-Manifest $manifest

    & git add -A -- $relativePath "public/projects/projects.json"

    Write-Host ""
    Write-Host "Added '$Title' at $relativePath." -ForegroundColor Green
    Write-Host "Review with 'git status' and commit when ready."
}
finally {
    Pop-Location
    if ($tempClone -and (Test-Path $tempClone)) {
        Remove-Item -Recurse -Force $tempClone
    }
}
