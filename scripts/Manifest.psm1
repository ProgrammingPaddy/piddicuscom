<#
.SYNOPSIS
    Shared helpers for reading and writing projects/projects.json.
#>

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:ManifestPath = Join-Path $script:RepoRoot "projects\projects.json"
$script:ProjectsDir = Join-Path $script:RepoRoot "projects"

function Get-RepoRoot {
    return $script:RepoRoot
}

function Get-ProjectsDir {
    return $script:ProjectsDir
}

function Get-Manifest {
    if (-not (Test-Path $script:ManifestPath)) {
        return [pscustomobject]@{ projects = @() }
    }

    $raw = Get-Content -Path $script:ManifestPath -Raw -Encoding UTF8
    $manifest = $raw | ConvertFrom-Json

    # ConvertFrom-Json collapses a single-item array to a scalar; normalise it.
    $manifest.projects = @($manifest.projects)

    return $manifest
}

function Save-Manifest {
    param (
        [Parameter(Mandatory)]
        [object] $Manifest
    )

    $Manifest.projects = @($Manifest.projects)
    $json = $Manifest | ConvertTo-Json -Depth 5 -Compress

    # ConvertTo-Json escapes a few characters as \uXXXX; JSON.parse handles
    # those fine, but they are ugly to read, so unescape the common ones.
    $json = $json -replace '\\u0027', "'" -replace '\\u003c', '<' -replace '\\u003e', '>' -replace '\\u0026', '&'

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($script:ManifestPath, (Format-Json $json) + "`n", $utf8NoBom)
}

function Format-Json {
    <#
    .SYNOPSIS
        Re-indent compact JSON with two spaces. Windows PowerShell's own
        pretty printer uses very deep indentation that is hard to edit by hand.
    #>
    param (
        [Parameter(Mandatory)]
        [string] $Json
    )

    $indent = 0
    $inString = $false
    $escaped = $false
    $output = New-Object System.Text.StringBuilder

    foreach ($char in $Json.ToCharArray()) {
        if ($inString) {
            [void]$output.Append($char)
            if ($escaped) {
                $escaped = $false
            }
            elseif ($char -eq '\') {
                $escaped = $true
            }
            elseif ($char -eq '"') {
                $inString = $false
            }
            continue
        }

        switch ($char) {
            '"' {
                $inString = $true
                [void]$output.Append($char)
            }
            { $_ -eq '{' -or $_ -eq '[' } {
                $indent++
                [void]$output.Append($char).Append("`n").Append('  ' * $indent)
            }
            { $_ -eq '}' -or $_ -eq ']' } {
                $indent--
                [void]$output.Append("`n").Append('  ' * $indent).Append($char)
            }
            ',' {
                [void]$output.Append($char).Append("`n").Append('  ' * $indent)
            }
            ':' {
                [void]$output.Append(': ')
            }
            default {
                [void]$output.Append($char)
            }
        }
    }

    # Collapse empty containers that the loop split across lines.
    return $output.ToString() -replace '\[\s+\]', '[]' -replace '\{\s+\}', '{}'
}

function Test-Slug {
    param (
        [Parameter(Mandatory)]
        [string] $Slug
    )

    return $Slug -match '^[a-z0-9]+(?:-[a-z0-9]+)*$'
}

function ConvertTo-Slug {
    param (
        [Parameter(Mandatory)]
        [string] $Text
    )

    $slug = $Text.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    return $slug.Trim('-')
}

Export-ModuleMember -Function Get-RepoRoot, Get-ProjectsDir, Get-Manifest, Save-Manifest, Test-Slug, ConvertTo-Slug
