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
| `theme-tools a11y` | the accessibility and smoke checks only, in under a minute, against `npm run dev` (or `BASE_URL`); no build, HTML validation, Lighthouse or budget |
| `theme-tools release [minor\|patch\|major] [--no-quality] [--no-push]` | the release (below) |

### quality

Installs the latest Ghost 6 once (in `~/.cache/ghost-theme-tests`, never under `/tmp`: gscan deletes files from themes it finds there), starts it on port 2369 with a fresh database, uploads the zip, imports `demo/content.json`, uploads `routes.yaml` and sets a navigation with a dropdown. The demo's images on other hosts (picsum.photos, Ghost's default cover) are uploaded to that Ghost first and cached, so Ghost resizes them as it would a publisher's images and Lighthouse measures what a real site serves; Unsplash images stay, since Ghost resizes those by URL. Then:

- **Playwright**, desktop and mobile, on each page: status code, console errors, horizontal scrolling, HTML validation, and axe in each color scheme. Also the color scheme toggle, the mobile menu and a dropdown, with axe on the open menus.
- **Accessibility checks axe can't make** (`quality/a11y.spec.mjs`), each failing the run when `enforce` is on:
  - **Keyboard:** the first Tab stop is a skip link that moves to its target; every Tab stop is visible (not hidden, off-screen or covered) and has a visible focus style (the element looks different focused than not); Enter opens the dropdown and the mobile menu, Tab moves into the mobile menu, and Escape closes them with focus back on their button. WCAG 2.1.2, 2.4.1, 2.4.3, 2.4.7.
  - **Reflow:** no horizontal scrolling at 320px wide (400% zoom), also with WCAG's increased text spacing; text clipped by that spacing is listed, not failed. WCAG 1.4.10, 1.4.12.
  - **Reduced motion:** with it on, no animation runs forever or longer than 5 seconds; smooth scrolling that stays on is listed. WCAG 2.2.2.
  - **Forced colors** (Windows High Contrast): screenshots of the home page and the post in `quality-results/forced-colors/`, to look at.
- **Signed in** (`quality/members.spec.mjs`): the test Ghost also gets a second newsletter, four custom fields on Ghost 6.78+ (short text, list and address members can edit, and a read-only one), and a member, Reader O'Brien, signed in once through a Ghost sign-in link. As that member:
  - each page in `quality.members.pages` (the account and membership pages and the home page by default): status, console errors, horizontal scrolling and axe in each color scheme; pages the site doesn't have are skipped
  - on an account page built from Skeleton's member partials (`data-member-*` hooks): the name is shown and saved, a newsletter goes on and off, the read-only custom field is shown and a custom field is saved, each checked against what Ghost then holds
- Before axe reads a page, empty text fields get sample text: an empty field has no text to check contrast on, so light text on a white field in dark mode would otherwise pass.
- **Lighthouse** on the home page and the longest post (3 runs each).
- **Size budget** of the built files, gzipped.

The pages come from the demo content: home, page 2, the longest post, a members-only and a paid post, a post and a page for each custom template, a page, the most-used tag and author, and the 404 page. Their URLs come from Ghost, so collections in `routes.yaml` are respected.

Signed-in checks run only on the test Ghost `quality` starts, not with `BASE_URL` or in `a11y`.

On GitHub Actions, the summary of each run is also written to the run's page (the job summary).

Results land in `quality-results/`: `report/index.html` (Playwright), `findings/` (one JSON per page and check), `forced-colors/`, `lighthouse/` and `pages.json`.

Automated checks find part of what WCAG asks. Before a release, also listen to the home page and a post with a screen reader (VoiceOver on a Mac, NVDA on Windows): headings, landmarks, link and button names, image descriptions, and the menus.

### a11y

The quick version while you work: with `npm run dev` running (or `BASE_URL` pointing at any Ghost with the theme active), it runs the Playwright checks above in under a minute. The pages come from `demo/content.json` at Ghost's default URLs; ones the site doesn't have are skipped.

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
    "report": false,
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
    "a11y": {
      "skipLink": true,
      "tabStops": 40,
      "keyboardPages": ["home", "post"],
      "reflowPages": ["home", "post", "page", "tag", "author", "error-404"],
      "motionPages": ["home", "post"],
      "forcedColorsPages": ["home", "post"]
    },
    "axe": { "failOn": ["critical", "serious"], "ignore": [] },
    "html": { "maxErrors": 0, "ignore": [] },
    "lighthouse": { "performance": 0.85, "accessibility": 0.95, "best-practices": 0.95, "seo": 0.95 },
    "budget": {},
    "members": { "enabled": true, "pages": ["/account/", "/membership/", "/"] },
    "ghost": { "navigation": null, "accentColor": "#5544ff", "routes": true }
  }
}
```

- **`zip.exclude`**: more `zip -x` patterns, added to the built-in ones (`dist*`, `demo*`, `node_modules*`, dotfiles, `TODO.md`, `private.hbs`, `theme.js`, `scripts*`, `prototypes*`, `tests*`, `quality-results*`, `DEVELOPMENT.md`, `CLAUDE.md`, `theme-tools.json`). `AGENTS.md` ships on purpose: it tells buyers' AI assistants how the theme works, so internal notes (setup steps, the brief, release notes) belong in `DEVELOPMENT.md`.
- **`quality.enforce`**: `false` reports findings without failing on them (only the smoke checks fail), for a first run on an older theme.
- **`quality.report`**: `true` reports everything, smoke checks and Lighthouse included, and the run always passes. For a theme moving to theme-tools: its CI shows the findings without blocking pull requests, until the fixes land and it's turned off. On GitHub Actions the summary also goes on the run's page.
- **`quality.pages`**: replaces the picked pages; `extraPages` adds to them. Each is `{ "name": "…", "path": "/…/" }`, with `"status": 404` for an expected error.
- **`quality.colorScheme`**: `{ "attribute", "values" }` sets an attribute on `<html>`; `{ "class": "dark" }` toggles a class; `null` tests one scheme, as the page loads.
- **`quality.interactions`**: the selectors for the menu test; `null` skips that part (the summary lists what was skipped).
- **`quality.a11y`**: the keyboard, reflow, motion and forced colors checks, by page name (the names in `quality-results/pages.json`). `skipLink: false` for a theme without one; `tabStops` is how many Tab stops the keyboard check follows.
- **`quality.axe.ignore`** and **`quality.html.ignore`**: findings to ignore, each with a `reason`. `{ "id": "rule", "target": "part of the selector" }` for axe, `{ "match": "start of the message" }` for HTML. Findings in Ghost's own card markup are ignored already.
- **`quality.budget`**: `{ "assets/built/app.js": 40 }`, in gzipped KB.
- **`quality.members`**: `enabled: false` sets up no member and skips the signed-in checks; `pages` are the pages checked signed in.
- **`quality.ghost.navigation`**: Ghost navigation items (`[{ "label", "url" }]`) instead of the default, which has a dropdown in Skeleton's style (`-` items).

## Versions

Themes use `main`: the package as `github:brightthemes/theme-tools#main`, pinned to a commit by each theme's lockfile (`npm update @brightthemes/theme-tools` moves it), and the workflows as `@main`, which every theme picks up at once. Skeleton is the testing ground for changes to theme-tools:

1. Change theme-tools on a branch.
2. In a Skeleton branch, install that branch (`npm install github:brightthemes/theme-tools#<branch>`) and, for workflow changes, point Skeleton's workflows to `@<branch>`. Open a pull request: Skeleton's CI runs the checks with the change.
3. Once it passes, merge the theme-tools branch, and set Skeleton back to `#main` and `@main` (`npm install github:brightthemes/theme-tools#main` updates its lockfile to the merged commit).

Workflow changes reach every theme as soon as they're on `main`, so test those on Skeleton first.
