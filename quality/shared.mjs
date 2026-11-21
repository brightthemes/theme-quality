import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadConfig, readJson, results } from '../lib/config.mjs';

export const { quality } = loadConfig();
export const pages = readJson(join(results, 'pages.json'));
// The signed-in member set up on the test Ghost (quality/ghost.mjs), when there is one
export const memberFile = join(results, 'member.json');
export const memberStateFile = join(results, 'member-state.json');
export const member = existsSync(memberFile) ? readJson(memberFile) : null;
export const byName = (names) => pages.filter((p) => names.includes(p.name));

// `theme-tools a11y`: a quick run against a dev server or a running Ghost, which may not have
// every demo page (those are skipped) and whose HTML has dev-only additions (not validated)
export const quick = !!process.env.THEME_TOOLS_QUICK;

export const record = (info, name, data) => {
  const dir = join(results, 'findings', info.project.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 2));
};

// Transitions and smooth scrolling off, so checks don't read the page halfway through either
export const noTransitions = (page) => page.addStyleTag({
  content: '*, *::before, *::after { transition: none !important; scroll-behavior: auto !important; }'
});

// Errors from the site itself: uncaught errors, and console errors from its own pages and scripts.
// Embeds (YouTube, Vimeo…) log errors from their own frames and scripts, which a theme can't change,
// such as Chrome's "Permissions policy violation" for features a player tries to use.
export function watchConsole(page) {
  const errors = [];
  const origin = new URL(process.env.BASE_URL).origin;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const source = message.location()?.url;
    if (source && !source.startsWith(origin)) return;
    errors.push(message.text());
  });
  return errors;
}

// Opens a page; in quick mode a page the site doesn't have is skipped instead of failing
export async function open(page, test, { path, status = 200 }) {
  const response = await page.goto(path, { waitUntil: 'networkidle' });
  if (quick && status === 200 && response.status() === 404) test.skip(true, `${path} isn't on this site`);
  return response;
}

// Ghost's Portal and search widgets and third-party embeds aren't part of the theme
const axe = (page) => new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
  .exclude('#ghost-portal-root')
  .exclude('#sodo-search-root')
  .exclude('iframe');

const ignored = (id, node) => quality.axe.ignore.some((i) => i.id === id && node.target.join(' ').includes(i.target));

const summarize = (violations) => violations
  .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !ignored(v.id, n)) }))
  .filter((v) => v.nodes.length)
  .map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    examples: v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')}: ${n.any[0]?.message || n.failureSummary}`)
  }));

// Color schemes to test: { attribute, values } sets an attribute on <html>, { class } toggles a class
// for dark mode, null tests the page as it loads
export const scheme = quality.colorScheme;
export const schemes = !scheme ? ['default'] : scheme.class ? ['light', 'dark'] : scheme.values;

// Without transitions, so axe doesn't read colors halfway between two schemes
const setScheme = async (page, value) => {
  if (!scheme) return;
  await noTransitions(page);
  await page.evaluate(({ scheme, value }) => {
    const html = document.documentElement;
    if (scheme.class) html.classList.toggle(scheme.class, value === 'dark');
    else html.setAttribute(scheme.attribute, value);
  }, { scheme, value });
};

// Empty text fields have no text to check contrast on, so they get some first: a field whose
// typed text can't be read (light text on a white field in dark mode) fails like any other text
export const fillEmptyFields = (page) => page.evaluate(() => {
  const sample = { email: 'reader@example.com', number: '42', tel: '+442079460000', url: 'https://example.com' };
  const fields = document.querySelectorAll('input:not([type]), input[type=text], input[type=email], input[type=search], input[type=tel], input[type=url], input[type=number], textarea');
  for (const field of fields) {
    if (!field.value && !field.disabled && field.offsetParent !== null) field.value = sample[field.type] || 'Sample text';
  }
});

export const axeAllSchemes = async (page) => {
  const found = {};
  await fillEmptyFields(page);
  for (const value of schemes) {
    await setScheme(page, value);
    found[value] = summarize((await axe(page).analyze()).violations);
  }
  return found;
};

export const assertTargets = (findings) => {
  if (!quality.enforce) return;
  expect(findings.html, 'HTML validation errors').toHaveLength(quality.html.maxErrors);
  for (const [value, violations] of Object.entries(findings.axe)) {
    expect(violations.filter((v) => quality.axe.failOn.includes(v.impact)), `accessibility violations (${value})`).toEqual([]);
  }
};
