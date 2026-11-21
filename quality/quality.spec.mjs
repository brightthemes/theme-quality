import { test, expect } from '@playwright/test';
import { HtmlValidate } from 'html-validate';
import { assertTargets, axeAllSchemes, open, pages, quality, quick, record, scheme } from './shared.mjs';

const htmlValidate = new HtmlValidate({ extends: ['html-validate:standard'] });

for (const { name, path, status = 200 } of pages) {
  test(name, async ({ page }, info) => {
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

    const response = await open(page, test, { path, status });
    expect(response.status(), `${path} status`).toBe(status);

    // The dev server adds its own script, and its console has dev messages: no HTML or console checks there
    const report = quick ? { results: [] } : await htmlValidate.validateString(await response.text());
    const findings = {
      path,
      consoleErrors: quick ? [] : consoleErrors.filter((e) => !(status !== 200 && e.includes(`status of ${status}`))),
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
