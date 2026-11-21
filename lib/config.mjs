import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

// The theme is the folder the command runs in (npm scripts run in the package root)
export const root = resolve(process.env.THEME_ROOT || process.cwd());
export const results = join(root, 'quality-results');
export const configFile = join(root, 'theme-tools.json');

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function themePackage() {
  const file = join(root, 'package.json');
  if (!existsSync(file)) throw new Error(`No package.json in ${root}: run theme-tools in a theme's folder`);
  return readJson(file);
}

// Files and folders that never go into a theme zip (zip -x patterns, relative to the theme root).
// AGENTS.md ships: it tells buyers' AI assistants how the theme works. Internal notes go in DEVELOPMENT.md.
const zipExclude = [
  'dist*', 'demo*', 'node_modules*', '.*', 'TODO.md', 'private.hbs', 'theme.js',
  'scripts*', 'prototypes*', 'tests*', 'quality-results*', 'DEVELOPMENT.md', 'CLAUDE.md', 'theme-tools.json'
];

// Findings in Ghost's own markup, which a theme can't change
const ghostIgnores = {
  axe: [
    { id: 'label', target: '.kg-video-', reason: "Ghost's video card controls" },
    { id: 'label', target: '.kg-audio-', reason: "Ghost's audio card controls" },
    { id: 'label-content-name-mismatch', target: '-playback-rate', reason: "Ghost's audio and video card controls" }
  ],
  html: [
    { match: 'no-deprecated-attr: Attribute "frameborder"', reason: 'Embeds as the oEmbed provider sends them' },
    { match: 'attribute-allowed-values: Attribute "required" has invalid value "true"', reason: "Ghost's signup card" }
  ]
};

const defaults = {
  zip: { exclude: [] },
  release: { quality: true, stamp: true },
  quality: {
    enforce: true,
    // null: picked from demo/content.json (see quality/pages.mjs)
    pages: null,
    extraPages: [],
    lighthousePages: ['home', 'post'],
    colorScheme: { attribute: 'data-color-scheme', values: ['light', 'dark'] },
    interactions: {
      colorSchemeToggle: '[data-color-scheme-toggle]',
      menuToggle: '[data-menu-toggle]',
      menu: '#menu',
      dropdownToggle: {
        desktop: '[data-nav="header"] li.is-mainitem > button',
        mobile: '[data-nav="mobile"] li.is-mainitem > button'
      }
    },
    // Checks axe can't make (quality/a11y.spec.mjs), by page name
    a11y: {
      skipLink: true,
      tabStops: 40,
      keyboardPages: ['home', 'post'],
      reflowPages: ['home', 'post', 'page', 'tag', 'author', 'error-404'],
      motionPages: ['home', 'post'],
      forcedColorsPages: ['home', 'post']
    },
    axe: { failOn: ['critical', 'serious'], ignore: [] },
    html: { maxErrors: 0, ignore: [] },
    lighthouse: { performance: 0.85, accessibility: 0.95, 'best-practices': 0.95, seo: 0.95 },
    budget: {},
    ghost: { navigation: null, accentColor: '#5544ff', routes: true }
  }
};

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Objects merge, arrays and values replace
function merge(base, over) {
  if (!isObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObject(base?.[k]) ? merge(base[k], v) : v;
  return out;
}

export function loadConfig() {
  const own = existsSync(configFile) ? readJson(configFile) : {};
  const config = merge(defaults, own);
  // The theme's lists add to the built-in ones
  config.zip.exclude = [...zipExclude, ...(own.zip?.exclude || [])];
  config.quality.axe.ignore = [...ghostIgnores.axe, ...(own.quality?.axe?.ignore || [])];
  config.quality.html.ignore = [...ghostIgnores.html, ...(own.quality?.html?.ignore || [])];
  return config;
}
