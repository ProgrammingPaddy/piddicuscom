# Piddicus

Personal site and project shelf. Static HTML, CSS and vanilla JS with no
build step. The homepage is a menu of self-contained HTML projects, each of
which lives in its own git repository and is mounted here as a submodule.

## Layout

```
index.html              Homepage (the menu)
css/
  base.css              Design tokens, reset, typography
  layout.css            Header, hero, sections, footer, backdrop
  components.css        Buttons, filter chips, project cards
  animations.css        Keyframes, scroll reveal, reduced-motion overrides
js/
  main.js               Loads the manifest and renders the menu
projects/
  projects.json         Manifest: one entry per mounted project
  <slug>/               One submodule per project
scripts/
  add-project.ps1       Mount a repo as a project
  update-projects.ps1   Pull the latest commit for one or all projects
  remove-project.ps1    Unmount a project
  Manifest.psm1         Shared helpers used by the scripts above
```

## Running locally

The homepage fetches `projects/projects.json`, so it needs to be served over
HTTP rather than opened from disk:

```bash
python -m http.server 8080
```

Then open http://localhost:8080.

## Adding a project

Any repo whose root (or a subfolder) contains a static entry page will work.

```powershell
.\scripts\add-project.ps1 `
    -Url https://github.com/ProgrammingPaddy/snake.git `
    -Title "Snake" `
    -Description "Classic snake on a canvas." `
    -Icon "🐍" `
    -Tags game,canvas
```

This clones the repo into `projects/snake` as a submodule and adds a card to
the manifest. Optional flags: `-Slug` (folder name, defaults to a slugified
title), `-Entry` (page to open, defaults to `index.html`), and `-Branch`
(branch to track, defaults to the repo's default branch).

The script stages the changes but does not commit. Commit them yourself:

```bash
git commit -m "Add snake project"
```

## Updating projects

After pushing new commits to a project's own repo, pull them into the site:

```powershell
.\scripts\update-projects.ps1           # all projects
.\scripts\update-projects.ps1 -Slug snake
```

This moves the submodule pointer to the latest commit on its tracked branch
and stages the change. Commit to publish the update.

## Removing a project

```powershell
.\scripts\remove-project.ps1 -Slug snake
```

## Manifest format

```json
{
  "projects": [
    {
      "slug": "snake",
      "title": "Snake",
      "description": "Classic snake on a canvas.",
      "icon": "🐍",
      "tags": ["game", "canvas"],
      "entry": "index.html",
      "repo": "https://github.com/ProgrammingPaddy/snake.git"
    }
  ]
}
```

Cards render in manifest order. Edit the file by hand to reorder, retitle, or
change tags; the scripts only add and remove entries.

## Cloning this repo

Submodules are not fetched by a plain clone. Use:

```bash
git clone --recurse-submodules https://github.com/ProgrammingPaddy/piddicuscom.git
```

Or, in an existing checkout:

```bash
git submodule update --init
```

## Hosting

Works as-is on GitHub Pages, Netlify, Cloudflare Pages or any static host.
GitHub Pages resolves public submodules automatically. Netlify and Cloudflare
Pages clone with submodules when the submodule URLs are public HTTPS URLs.
