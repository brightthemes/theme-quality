import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { HtmlValidate } from 'html-validate';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadConfig, readJson, results } from '../lib/config.mjs';

const { quality } = loadConfig();
const pages = readJson(join(results, 'pages.json'));
const htmlValidate = new HtmlValidate({ extends: ['html-validate:standard'] });

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

const record = (info, name, data) => {
  const dir = join(results, 'findings', info.project.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 2));
};

// Color schemes to test: { attribute, values } sets an attribute on <html>, { class } toggles a class
// for dark mode, null tests the page as it loads
const scheme = quality.colorScheme;
const schemes = !scheme ? ['default'] : scheme.class ? ['light', 'dark'] : scheme.values;

// Without transitions, so axe doesn't read colors halfway between two schemes
const setScheme = async (page, value) => {
  if (!scheme) return;
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  await page.evaluate(({ scheme, value }) => {
    const html = document.documentElement;
    if (scheme.class) html.classList.toggle(scheme.class, value === 'dark');
    else html.setAttribute(scheme.attribute, value);
  }, { scheme, value });
};

const axeAllSchemes = async (page) => {
  const found = {};
  for (const value of schemes) {
    await setScheme(page, value);
    found[value] = summarize((await axe(page).analyze()).violations);
  }
  return found;
};

const assertTargets = (findings) => {
  if (!quality.enforce) return;
  expect(findings.html, 'HTML validation errors').toHaveLength(quality.html.maxErrors);
  for (const [value, violations] of Object.entries(findings.axe)) {
    expect(violations.filter((v) => quality.axe.failOn.includes(v.impact)), `accessibility violations (${value})`).toEqual([]);
  }
};

for (const { name, path, status = 200 } of pages) {
  test(name, async ({ page }, info) => {
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

    const response = await page.goto(path, { waitUntil: 'networkidle' });
    expect(response.status(), `${path} status`).toBe(status);

    const report = await htmlValidate.validateString(await response.text());
    const findings = {
      path,
      consoleErrors: consoleErrors.filter((e) => !(status !== 200 && e.includes(`status of ${status}`))),
      horizontalScroll: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      html: report.results.flatMap((r) => r.messages).filter((m) => m.severity === 2)
        .map((m) => `${m.ruleId}: ${m.message} (line ${m.line}: ${m.selector})`)
        .filter((m) => !quality.html.ignore.some((i) => m.startsWith(i.match))),
      axe: await axeAllSchemes(page)
    };
    record(info, name, findings);

    expect(findings.consoleErrors, 'console errors').toEqual([]);
    expect(findings.horizontalScroll, 'horizontal scrolling').toBe(false);
    assertTargets(findings);
  });
}

// The color scheme toggle, the mobile menu and a dropdown, with axe on the open menus.
// A selector set to null in "quality.interactions" skips that part.
test('menus', async ({ page, isMobile }, info) => {
  const { colorSchemeToggle, menuToggle, menu, dropdownToggle } = quality.interactions;
  const skipped = [];
  const present = async (selector, label) => {
    if (selector && await page.locator(selector).first().count()) return true;
    skipped.push(label);
    return false;
  };
  await page.goto('/', { waitUntil: 'networkidle' });

  if (await present(colorSchemeToggle, 'color scheme toggle') && scheme && !scheme.class) {
    const html = page.locator('html');
    const before = await html.getAttribute(scheme.attribute);
    const toggle = page.locator(colorSchemeToggle).first();
    await toggle.click();
    await expect(html).not.toHaveAttribute(scheme.attribute, before);
    await toggle.click();
    await expect(html).toHaveAttribute(scheme.attribute, before);
  }

  if (isMobile && await present(menuToggle, 'menu toggle')) {
    await page.locator(menuToggle).first().click();
    if (menu) await expect(page.locator(menu)).toBeVisible();
  }

  const dropdown = dropdownToggle?.[isMobile ? 'mobile' : 'desktop'];
  let toggle;
  if (await present(dropdown, 'dropdown')) {
    toggle = page.locator(dropdown).first();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }

  const findings = { axe: await axeAllSchemes(page), skipped };

  if (toggle) {
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }

  record(info, isMobile ? 'menus-mobile-open' : 'menus-dropdown-open', findings);
  assertTargets({ html: [], axe: findings.axe });
});
