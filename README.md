# Piddicus

Personal site and project shelf. Static HTML, CSS and vanilla JS with no
build step, no backend and no database. The homepage is a menu of
self-contained HTML projects. Hosted on Cloudflare Workers as static assets.

## Layout

```
wrangler.jsonc            Cloudflare config (assets-only, no Worker script)
README.md
public/                   Everything in here is served; nothing outside is
  index.html              Homepage (the menu)
  css/
    base.css              Design tokens, reset, typography
    layout.css            Header, hero, sections, footer, backdrop
    components.css        Buttons, filter chips, project cards
    animations.css        Keyframes, scroll reveal, reduced-motion overrides
  js/
    main.js               Loads the manifest and renders the menu
  projects/
    projects.json         Manifest: one entry per project
    <slug>/               One folder per project, fully self-contained
scripts/
  add-project.ps1         Add a project (from a repo, a local folder, or empty)
  update-projects.ps1     Pull the latest commit for repo-backed projects
  remove-project.ps1      Remove a project
  Manifest.psm1           Shared helpers used by the scripts above
```

## Running locally

The homepage fetches `projects/projects.json`, so it needs to be served over
HTTP rather than opened from disk:

```bash
python -m http.server 8080 --directory public
```

Then open http://localhost:8080.

## Adding a project

Every project is a plain folder under `public/projects/<slug>` with its own
entry page. The add script fills the folder and writes the manifest entry.
Choose where the files come from:

**From the project's own git repo.** The files are copied in and pinned to
the latest commit. The repo URL, branch and commit are recorded in the
manifest so `update-projects.ps1` can refresh it later.

```powershell
.\scripts\add-project.ps1 `
    -Title "Snake" `
    -Url https://github.com/ProgrammingPaddy/snake.git `
    -Description "Classic snake on a canvas." `
    -Icon "🐍" `
    -Tags game,canvas
```

**From a local folder.** For projects that do not have a repo.

```powershell
.\scripts\add-project.ps1 -Title "Colour Mixer" -Path ..\colour-mixer -Tags tool
```

**Empty.** Creates a starter `index.html` to build on directly in this repo.

```powershell
.\scripts\add-project.ps1 -Title "Scratch Pad"
```

Optional flags for all three: `-Slug` (folder name, defaults to a slugified
title), `-Entry` (page to open, defaults to `index.html`), and `-Branch`
(with `-Url` only, defaults to the repo's default branch).

The script stages the changes but does not commit. Commit and push to deploy:

```bash
git commit -m "Add snake project"
```

Projects are copied rather than mounted as git submodules. That keeps every
deploy self-contained: the host never has to reach a second repository, a
project can exist without one, and a project repo going private or missing
cannot break the site.

## Updating projects

After pushing new commits to a project's own repo, pull them into the site:

```powershell
.\scripts\update-projects.ps1           # all repo-backed projects
.\scripts\update-projects.ps1 -Slug snake
```

Projects without a repo are skipped. Edit those directly in
`public/projects/<slug>`.

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
      "repo": "https://github.com/ProgrammingPaddy/snake.git",
      "branch": "main",
      "commit": "c37e1c0096328bae0fc8b80c099a7eef17db81d4"
    }
  ]
}
```

`repo`, `branch` and `commit` are `null` for projects without a repo. Cards
render in manifest order. Edit the file by hand to reorder, retitle, or
change tags; the scripts only add, update and remove entries.

## Deployment

The GitHub repo is connected to a Cloudflare Worker through Workers Builds.
Every push runs `npx wrangler deploy`, which uploads `public/` as static
assets. There is no build command and no manual deploy step.

`wrangler.jsonc` deliberately has no `main` key. That makes it an
assets-only Worker with no script. Leave `compatibility_date` alone; it is
pinned to the project start date and changing it alters runtime behaviour.

### First deploy checklist

1. Push to `main` and watch the build in the Cloudflare dashboard.
2. Open the generated `*.workers.dev` URL and confirm the homepage loads.
3. In the Worker's **Settings → Domains & Routes**, choose **Add custom
   domain** and enter the domain. Cloudflare creates the DNS record and
   certificate itself. Do not hand-create DNS records for this.
4. If the domain hosted email through Squarespace, confirm the MX records
   exist in Cloudflare DNS. They had to be recreated after the nameserver
   switch and are not part of this repo.

If a deploy fails immediately, check that `wrangler.jsonc` exists at the
repo root and that `assets.directory` matches the `public/` folder.

### Future expansion

When one project eventually needs a server-side endpoint, add `src/index.js`
and point `main` at it in `wrangler.jsonc`. Static assets keep being served
exactly as before; the Worker only handles requests that do not match a
file. Nothing else needs to move.
