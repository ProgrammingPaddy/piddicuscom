# Piddicus

Personal site: a menu of self-contained browser projects. Plain HTML, CSS
and JavaScript, served as static assets by Cloudflare Workers.

```
public/               Everything served
  index.html          The menu
  logo.svg            Wordmark (header, hero, footer, project bars)
  css/  js/           Site styles and scripts
  projects/
    <name>/           A project. Drop a folder here and it is on the site.
    <name>.html       A single-file project works too.
    _template/        Starter to copy (never listed, never deployed)
    projects.json     Generated menu manifest. Do not edit.
scripts/              build.mjs (manifest), sync.mjs (repo-backed projects)
.githooks/pre-commit  Regenerates the manifest on every commit
wrangler.jsonc        Cloudflare config (assets-only, no Worker script)
```

## Setup and local preview

```bash
npm install
npm run dev
```

Install once per clone: it fetches wrangler and wires up the pre-commit
hook. Dev serves http://localhost:8787 with production's asset rules and
regenerates the manifest on start (`npm run build` does it on demand).

## Adding a project

Drop a folder with an `index.html` (or a lone `.html` file) into
`public/projects`, commit, push. The hook keeps `projects.json` in sync.
Delete the folder to remove the project. Names starting with `_` or `.`
are ignored.

**Back-to-menu bar.** Add one line anywhere in the project's HTML:

```html
<script src="../../js/return-home.js" defer></script>
```

**Card details.** With nothing else, the card uses the page's `<title>`,
`<meta name="description">` and `<meta name="keywords">` (as tags). For more
control add `project.json` next to the entry page. All fields optional:

```json
{
  "title": "Snake",
  "description": "Classic snake on a canvas.",
  "icon": "icon.png",
  "tags": ["games"],
  "entry": "play.html",
  "order": 1,
  "hidden": false
}
```

- `tags` are the menu's categories: keep them plural and reuse `games`,
  `music`, `tools` before adding new ones.
- `icon` is an image in the folder (or a URL). Without one the card draws a
  pink blob with the project's initials.
- `order` sorts lower first; unordered projects follow alphabetically.
- `hidden: true` deploys the folder but keeps it off the menu.

**Projects with their own repo.** Give sync the clone URL once:

```bash
npm run sync -- https://github.com/ProgrammingPaddy/snake
```

It creates the folder, records the repo in its `project.json`, and copies
the files in at the latest commit. Later, `npm run sync` refreshes every
repo-backed project (`npm run sync -- snake` for one, `--force` to re-copy
regardless). Your `project.json` is never overwritten. Files are copied,
not submoduled, so a deploy never depends on another repository.

Two optional keys in that `project.json`: `"branch"` tracks a branch other
than the default, and `"root": "some/folder"` copies only that subfolder of
the repo (for repos where the page is not at the top level). If the copied
folder has its own `project.json`, sync saves it as `project.repo.json` and
the build uses it for any field yours does not set.

## Deployment

Pushing `main` triggers Workers Builds, which runs `npm install` and
`npx wrangler deploy`. No build command is needed because the manifest is
committed. `npm run deploy` does the same from this machine after
`npx wrangler login`.

Leave `compatibility_date` alone. Do not add `main` to `wrangler.jsonc`
unless a project needs a server-side endpoint; when one does, add
`src/index.js` and point `main` at it, and static files keep serving as
before. The custom domain is attached in the Worker's dashboard settings,
not through DNS records in this repo. Squarespace email on the domain
depends on MX records that live in Cloudflare DNS.
