// Checks as a signed-in member (set up by quality/ghost.mjs, signed in by member-setup.mjs).
// Only on the test Ghost `theme-tools quality` starts: skipped with BASE_URL and in quick mode.
import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { assertTargets, axeAllSchemes, member, memberStateFile, quality, quick, record } from './shared.mjs';

const signedIn = !quick && !!member && existsSync(memberStateFile);
const pageName = (path) => `member-${path === '/' ? 'home' : path.replace(/^\/|\/$/g, '').replace(/\//g, '-')}`;

test.describe('signed in', () => {
  test.skip(!signedIn, 'No signed-in member on this Ghost');
  test.use({ storageState: signedIn ? memberStateFile : undefined });

  // Each page as the member sees it: status, console errors, horizontal scrolling, axe
  for (const path of quality.members.pages) {
    test(`signed in: ${path}`, async ({ page }, info) => {
      const consoleErrors = [];
      page.on('pageerror', (e) => consoleErrors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

      const response = await page.goto(path, { waitUntil: 'networkidle' });
      if (response.status() === 404) test.skip(true, `${path} isn't on this site`);
      expect(response.status(), `${path} status`).toBe(200);
      expect(await page.evaluate(() => fetch('/members/api/member/').then((r) => r.status)), 'signed in').toBe(200);

      const findings = {
        path,
        consoleErrors,
        horizontalScroll: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
        axe: await axeAllSchemes(page)
      };
      record(info, pageName(path), findings);
      expect(findings.consoleErrors, 'console errors').toEqual([]);
      expect(findings.horizontalScroll, 'horizontal scrolling').toBe(false);
      assertTargets({ html: [], axe: findings.axe });
    });
  }

  // The account page, where it's built from Skeleton's member partials (data-member-* hooks):
  // details, a newsletter on and off, and custom fields saved through the page
  test('signed in: account page saves', async ({ page, isMobile }, info) => {
    test.skip(isMobile, 'Runs on desktop');
    const account = quality.members.pages.find((p) => p.includes('account')) || '/account/';
    const response = await page.goto(account, { waitUntil: 'networkidle' });
    if (response.status() === 404 || !(await page.locator('[data-member-emails]').count())) {
      test.skip(true, "The account page doesn't use Skeleton's member partials");
    }
    page.on('dialog', (d) => d.accept());
    const own = () => page.evaluate(() => fetch('/members/api/member/').then((r) => r.json()));
    const issues = [];
    const attempt = async (label, fn) => {
      try { await fn(); } catch (error) { issues.push(`${label}: ${error.message.split('\n')[0]}`); }
    };

    await attempt('Name shown', async () => {
      expect(await page.inputValue('[data-member-profile] input[name=name]')).toBe(member.name);
    });

    await attempt('Name saved', async () => {
      await page.click('[data-member-profile] [data-member-edit]');
      await page.fill('[data-member-profile] input[name=name]', 'Reader Two');
      await page.click('[data-member-profile] [data-member-save]');
      await expect.poll(async () => (await own()).name, { timeout: 5000 }).toBe('Reader Two');
    });

    await attempt('Newsletter on and off', async () => {
      const boxes = page.locator('[data-member-newsletters] input[type=checkbox]');
      const count = await boxes.count();
      if (count < 2) return;
      const before = (await own()).newsletters.length;
      const off = boxes.nth(count - 1);
      expect(await off.isChecked(), 'checkboxes match the member').toBe(false);
      await off.check();
      await expect.poll(async () => (await own()).newsletters.length, { timeout: 5000 }).toBe(before + 1);
      await off.uncheck();
      await expect.poll(async () => (await own()).newsletters.length, { timeout: 5000 }).toBe(before);
    });

    if (member.fields?.length) {
      const fields = page.locator('[data-member-custom-fields]');
      const company = member.fields.find((f) => f.name === 'Company');
      await attempt('Read-only custom field shown', async () => {
        await expect(fields).toContainText('A-1001', { timeout: 5000 });
      });
      await attempt('Custom field saved', async () => {
        await fields.locator('[data-member-edit]').click();
        await fields.getByRole('textbox', { name: 'Company', exact: true }).fill('Bright Themes');
        await fields.locator('[data-member-save]').click();
        await expect.poll(async () => (await own()).metafields?.custom?.[company.key], { timeout: 5000 }).toBe('Bright Themes');
      });
    }

    record(info, 'member-account-saves', { path: account, issues });
    if (quality.enforce) expect(issues, 'account page').toEqual([]);
  });
});
