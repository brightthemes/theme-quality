# theme-tools

Shared dev tooling for Bright Themes' Ghost themes:

- **`zip`**: build, gscan, and zip the theme into `dist/`, with one list of files that never ship
- **`release`**: bump the version, stamp it into `default.hbs`, zip, run the quality checks, commit `vX.Y.Z` and push
- **`quality`**: smoke checks, accessibility (axe, WCAG 2.2 AA, light and dark), HTML validation, Lighthouse and a size budget, on a throwaway Ghost with the theme's demo content
- **Reusable GitHub workflows** for CI, releases and deploys

None of it goes into a theme zip: `theme-tools.json` and `quality-results/` are excluded. A theme's `package.json` and `package-lock.json` do ship (buyers rebuild with them), so they only gain theme-tools and gscan. The quality checks' own dependencies (Playwright, Lighthouse, axe, html-validate, about 270 MB) install into theme-tools' `quality/` folder on the first `setup` or `quality` run, from `quality/package-lock.json`.

## Set up a theme

```bash
npm install github:brightthemes/theme-tools#main
npx theme-tools setup
```

(`setup` installs the quality checks' dependencies and Chromium, once per machine and theme-tools version.)

Then, in the theme's `package.json`:

```json
"scripts": {
  "test": "theme-tools test",
  "test:quality": "theme-tools quality",
  "zip": "theme-tools zip",
  "stamp": "theme-tools stamp",
  "release": "theme-tools release"
}
```

Add `quality-results` to `.gitignore`, and `gscan` can come out of the theme's dependencies (theme-tools brings it).

The workflows, in the theme's `.github/workflows/`:

```yaml
# ci.yml
name: CI
on:
  pull_request:
permissions:
  contents: write
  pull-requests: write
jobs:
  ci:
    uses: brightthemes/theme-tools/.github/workflows/theme-ci.yml@main
    # with:
    #   quality: false   # until the theme has demo/content.json
```

```yaml
# release.yml
name: Release
on:
  push:
    branches: [main, master]
permissions:
  contents: write
jobs:
  release:
    uses: brightthemes/theme-tools/.github/workflows/theme-release.yml@main
```

```yaml
# deploy.yml
name: Deploy
on:
  push:
    branches: [main, master]
jobs:
  deploy:
    uses: brightthemes/theme-tools/.github/workflows/theme-deploy.yml@main
    secrets: inherit
```

## Commands

| Command | What it does |
|---|---|
| `theme-tools test` | gscan, Ghost's theme validator |
| `theme-tools zip [--no-build]` | `npm run build`, gscan, then `dist/<name>.zip` |
| `theme-tools stamp` | writes `<meta name="ghost-theme" content="Name 1.2.0">` into `default.hbs` |
| `theme-tools setup [--with-deps]` | installs the quality checks' dependencies and Chromium (`--with-deps`: its system libraries too, for CI) |
| `theme-tools quality [--no-zip]` | the quality checks (below) |
| `theme-tools release [minor\|patch\|major] [--no-quality] [--no-push]` | the release (below) |

### quality

Installs the latest Ghost 6 once (in `~/.cache/ghost-theme-tests`, never under `/tmp`: gscan deletes files from themes it finds there), starts it on port 2369 with a fresh database, uploads the zip, imports `demo/content.json`, uploads `routes.yaml` and sets a navigation with a dropdown. Then:

- **Playwright**, desktop and mobile, on each page: status code, console errors, horizontal scrolling, HTML validation, and axe in each color scheme. Also the color scheme toggle, the mobile menu and a dropdown, with axe on the open menus.
- **Lighthouse** on the home page and the longest post (3 runs each).
- **Size budget** of the built files, gzipped.

The pages come from the demo content: home, page 2, the longest post, a members-only and a paid post, a post and a page for each custom template, a page, the most-used tag and author, and the 404 page. Their URLs come from Ghost, so collections in `routes.yaml` are respected.

Results land in `quality-results/`: `report/index.html` (Playwright), `findings/` (one JSON per page), `lighthouse/` and `pages.json`.

Environment variables: `BASE_URL` tests a running Ghost instead (it must have the demo content); `GHOST_VERSION`, `GHOST_PORT`, `GHOST_DIR`; `CHROMIUM_PATH` and `CHROME_PATH` use a local Chromium.

### release

Needs a clean working tree. Bumps the version (minor by default), stamps `default.hbs`, zips, runs `quality` (unless `--no-quality` or `"release": { "quality": false }`), then commits `package.json`, `package-lock.json` and `default.hbs` as `vX.Y.Z` and pushes. If anything fails, the version bump is undone. The theme's release workflow publishes the GitHub release from that commit.

## theme-tools.json

Optional, in the theme's root. Every key is optional; these are the defaults:

```json
{
  "zip": { "exclude": [] },
  "release": { "quality": true, "stamp": true },
  "quality": {
    "enforce": true,
    "pages": null,
    "extraPages": [],
    "lighthousePages": ["home", "post"],
    "colorScheme": { "attribute": "data-color-scheme", "values": ["light", "dark"] },
    "interactions": {
      "colorSchemeToggle": "[data-color-scheme-toggle]",
      "menuToggle": "[data-menu-toggle]",
      "menu": "#menu",
      "dropdownToggle": {
        "desktop": "[data-nav=\"header\"] li.is-mainitem > button",
        "mobile": "[data-nav=\"mobile\"] li.is-mainitem > button"
      }
    },
    "axe": { "failOn": ["critical", "serious"], "ignore": [] },
    "html": { "maxErrors": 0, "ignore": [] },
    "lighthouse": { "performance": 0.85, "accessibility": 0.95, "best-practices": 0.95, "seo": 0.95 },
    "budget": {},
    "ghost": { "navigation": null, "accentColor": "#5544ff", "routes": true }
  }
}
```

- **`zip.exclude`**: more `zip -x` patterns, added to the built-in ones (`dist*`, `demo*`, `node_modules*`, dotfiles, `TODO.md`, `private.hbs`, `theme.js`, `scripts*`, `prototypes*`, `tests*`, `quality-results*`, `AGENTS.md`, `CLAUDE.md`, `theme-tools.json`).
- **`quality.enforce`**: `false` reports findings without failing on them (only the smoke checks fail), for a first run on an older theme.
- **`quality.pages`**: replaces the picked pages; `extraPages` adds to them. Each is `{ "name": "…", "path": "/…/" }`, with `"status": 404` for an expected error.
- **`quality.colorScheme`**: `{ "attribute", "values" }` sets an attribute on `<html>`; `{ "class": "dark" }` toggles a class; `null` tests one scheme, as the page loads.
- **`quality.interactions`**: the selectors for the menu test; `null` skips that part (the summary lists what was skipped).
- **`quality.axe.ignore`** and **`quality.html.ignore`**: findings to ignore, each with a `reason`. `{ "id": "rule", "target": "part of the selector" }` for axe, `{ "match": "start of the message" }` for HTML. Findings in Ghost's own card markup are ignored already.
- **`quality.budget`**: `{ "assets/built/app.js": 40 }`, in gzipped KB.
- **`quality.ghost.navigation`**: Ghost navigation items (`[{ "label", "url" }]`) instead of the default, which has a dropdown in Skeleton's style (`-` items).

## Versions

Themes use `main`: the package as `github:brightthemes/theme-tools#main`, pinned to a commit by each theme's lockfile (`npm update @brightthemes/theme-tools` moves it), and the workflows as `@main`, which every theme picks up at once. So change `main` through pull requests: the Self-test workflow runs each one on Skeleton. Version tags can come later without changing how themes use it.
