import { test, expect } from '@playwright/test';
import { HtmlValidate } from 'html-validate';
import { assertTargets, axeAllSchemes, open, pages, quality, quick, record, scheme, watchConsole } from './shared.mjs';

const htmlValidate = new HtmlValidate({ extends: ['html-validate:standard'] });

for (const { name, path, status = 200 } of pages) {
  test(name, async ({ page }, info) => {
    const consoleErrors = watchConsole(page);

    const response = await open(page, test, { path, status });
    expect(response.status(), `${path} status`).toBe(status);

    // The dev server adds its own script, and its console has dev messages: no HTML or console checks there
    // A page can redirect from a script (a members page while signed out): its HTML is then read again
    const html = quick ? '' : await response.text().catch(() => page.request.get(path).then((r) => r.text()));
    const report = quick ? { results: [] } : await htmlValidate.validateString(html);
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
  // The first visible match: a theme can have one toggle for wide screens and another in the menu
  const visible = (selector) => page.locator(selector).locator('visible=true').first();
  const present = async (selector, label) => {
    if (selector && await visible(selector).count()) return true;
    skipped.push(label);
    return false;
  };
  await page.goto('/', { waitUntil: 'networkidle' });

  if (await present(colorSchemeToggle, 'color scheme toggle') && scheme && !scheme.class) {
    const html = page.locator('html');
    // Each press changes the scheme (from "system" the first press can go to either light or dark)
    const before = await html.getAttribute(scheme.attribute);
    const toggle = visible(colorSchemeToggle);
    await toggle.click();
    await expect(html).not.toHaveAttribute(scheme.attribute, before);
    const after = await html.getAttribute(scheme.attribute);
    await toggle.click();
    await expect(html).not.toHaveAttribute(scheme.attribute, after);
  }

  if (isMobile && await present(menuToggle, 'menu toggle')) {
    await visible(menuToggle).click();
    if (menu) await expect(page.locator(menu)).toBeVisible();
  }

  const dropdown = dropdownToggle?.[isMobile ? 'mobile' : 'desktop'];
  let toggle;
  if (await present(dropdown, 'dropdown')) {
    toggle = visible(dropdown);
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
