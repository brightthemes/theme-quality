// Runs in quality-results/ (lib/quality.mjs), with THEME_ROOT and BASE_URL set
const { readFileSync } = require('fs');
const { join } = require('path');

const root = process.env.THEME_ROOT;
const results = join(root, 'quality-results');
const read = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };
const own = read(join(root, 'theme-tools.json')).quality || {};
const pages = read(join(results, 'pages.json'));
const names = own.lighthousePages || ['home', 'post'];
const scores = { performance: 0.85, accessibility: 0.95, 'best-practices': 0.95, seo: 0.95, ...own.lighthouse };

module.exports = {
  ci: {
    collect: {
      url: [].concat(pages).filter((p) => names.includes(p.name)).map((p) => new URL(p.path, process.env.BASE_URL).href),
      // Performance only warns: one run on CI (minutes count there), the median of three locally
      numberOfRuns: own.lighthouseRuns || (process.env.CI ? 1 : 3),
      chromePath: process.env.CHROME_PATH || undefined,
      settings: {
        chromeFlags: '--headless=new --no-sandbox',
        // Covered by axe in quality.spec.mjs, which can skip Ghost's own card controls
        skipAudits: ['label', 'label-content-name-mismatch']
      }
    },
    assert: {
      assertions: Object.fromEntries(Object.entries(scores).map(([category, minScore]) => [
        `categories:${category}`, [category === 'performance' ? 'warn' : 'error', { minScore }]
      ]))
    },
    upload: { target: 'filesystem', outputDir: join(results, 'lighthouse') }
  }
};
