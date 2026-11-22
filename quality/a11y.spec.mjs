// Accessibility checks axe can't make: keyboard use, reflow, text spacing, motion, forced colors
import { test, expect } from '@playwright/test';
import { join } from 'path';
import { results } from '../lib/config.mjs';
import { byName, noTransitions, open, quality, record } from './shared.mjs';

const settings = quality.a11y;
const fail = (issues, label) => quality.enforce && expect(issues, label).toEqual([]);

// A short description of the focused element, for the findings
const describe = () => {
  const el = document.activeElement;
  const text = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('href') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${text ? ` "${text}"` : ''}`;
};

// Whether the focused element can be seen: it has a size, it's in the viewport, and it isn't covered
const focusedIsVisible = () => {
  const el = document.activeElement;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
  const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
};

const clipAround = async (page) => {
  const r = await page.evaluate(() => {
    const b = document.activeElement.getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: b.height };
  });
  const vp = page.viewportSize();
  const x = Math.max(0, Math.floor(r.x - 6)), y = Math.max(0, Math.floor(r.y - 6));
  return { x, y, width: Math.min(vp.width - x, Math.ceil(r.width + 12)), height: Math.min(vp.height - y, Math.ceil(r.height + 12)) };
};

// WCAG 2.4.1, 2.4.3, 2.4.7: a skip link first, focus only on visible elements, a visible focus style
for (const { name, path } of byName(settings.keyboardPages)) {
  test(`keyboard: ${name}`, async ({ page, isMobile }, info) => {
    test.skip(isMobile, 'keyboard checks run on desktop');
    await open(page, test, { path });
    await noTransitions(page);
    const issues = [];

    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => {
      const el = document.activeElement;
      const href = el.getAttribute('href') || '';
      return { href, isSkip: el.tagName === 'A' && href.startsWith('#') && href.length > 1 && !!document.getElementById(href.slice(1)) };
    });
    if (settings.skipLink) {
      if (!first.isSkip) issues.push('The first Tab stop isn\'t a skip link to an element on the page');
      else {
        await page.keyboard.press('Enter');
        const moved = await page.evaluate((id) => location.hash === `#${id}` || !!document.getElementById(id)?.contains(document.activeElement), first.href.slice(1));
        if (!moved) issues.push(`The skip link doesn't move to ${first.href}`);
      }
      await page.goto(path, { waitUntil: 'networkidle' });
      await noTransitions(page);
    }

    const stops = [];
    for (let i = 0; i < settings.tabStops; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el.tagName === 'IFRAME') return null;
        el.dataset.ttFocus ||= String(Math.random());
        return el.dataset.ttFocus;
      });
      if (!id) { if (stops.length) break; else continue; }
      if (stops.includes(id)) break;
      stops.push(id);

      const label = await page.evaluate(describe);
      if (!(await page.evaluate(focusedIsVisible))) {
        issues.push(`Focus lands on ${label}, which can't be seen`);
        continue;
      }
      const clip = await clipAround(page);
      if (clip.width < 2 || clip.height < 2) continue;
      const focused = await page.screenshot({ clip });
      await page.evaluate(() => document.activeElement.blur());
      const blurred = await page.screenshot({ clip });
      await page.evaluate((id) => document.querySelector(`[data-tt-focus="${id}"]`)?.focus(), id);
      if (focused.equals(blurred)) issues.push(`${label} has no visible focus style`);
    }

    record(info, `keyboard-${name}`, { path, tabStops: stops.length, issues });
    fail(issues, 'keyboard');
  });
}

// WCAG 2.1.2, 2.4.3: menus open from the keyboard, focus moves into the mobile menu,
// and Escape closes them with focus back on their button
test('keyboard: menus', async ({ page, isMobile }, info) => {
  const { menuToggle, menu, dropdownToggle } = quality.interactions;
  await open(page, test, { path: '/' });
  await noTransitions(page);
  const issues = [];
  const skipped = [];
  const focusedIs = (selector) => page.evaluate((s) => document.activeElement === document.querySelector(s) || document.activeElement?.matches(s), selector);

  if (isMobile) {
    const toggle = menuToggle && page.locator(menuToggle).locator('visible=true').first();
    if (!toggle || !(await toggle.count())) skipped.push('menu toggle');
    else {
      await toggle.focus();
      await page.keyboard.press('Enter');
      if (menu && !(await page.locator(menu).isVisible())) issues.push('Enter on the menu button doesn\'t open the menu');
      else if (menu) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate((s) => !!document.querySelector(s)?.contains(document.activeElement), menu);
        if (!inside) issues.push('Tab after opening the menu doesn\'t move into it');
        await page.keyboard.press('Escape');
        if (await page.locator(menu).isVisible()) issues.push('Escape doesn\'t close the menu');
        else if (!(await focusedIs(menuToggle))) issues.push('Focus doesn\'t return to the menu button after Escape');
      }
    }
  } else {
    const selector = dropdownToggle?.desktop;
    const toggle = selector && page.locator(selector).locator('visible=true').first();
    if (!toggle || !(await toggle.count())) skipped.push('dropdown');
    else {
      await toggle.focus();
      await page.keyboard.press('Enter');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') issues.push('Enter on the dropdown button doesn\'t open it');
      else {
        await page.keyboard.press('Escape');
        if ((await toggle.getAttribute('aria-expanded')) !== 'false') issues.push('Escape doesn\'t close the dropdown');
        else if (!(await toggle.evaluate((el) => el === document.activeElement))) issues.push('Focus doesn\'t return to the dropdown button after Escape');
      }
    }
  }

  record(info, isMobile ? 'keyboard-menu-mobile' : 'keyboard-dropdown', { issues, skipped });
  fail(issues, 'menu keyboard');
});

// WCAG 1.4.10 and 1.4.12: no horizontal scrolling at 320px (400% zoom), with or without
// the text spacing users may set; text clipped by the extra spacing is reported, not failed
const textSpacing = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }`;
const clippedText = () => [...document.querySelectorAll('body *')].filter((el) => {
  const s = getComputedStyle(el);
  if (!/(hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY) || s.webkitLineClamp !== 'none' || s.textOverflow === 'ellipsis') return false;
  // Hidden on purpose (visually hidden text, collapsed content), not clipped
  if (el.clientWidth <= 1 || el.clientHeight <= 1 || s.clip !== 'auto' || s.clipPath !== 'none') return false;
  if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
  return el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
}).slice(0, 10).map((el) => `${el.tagName.toLowerCase()} "${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}"`);

for (const { name, path, status = 200 } of byName(settings.reflowPages)) {
  test(`reflow: ${name}`, async ({ page, isMobile }, info) => {
    test.skip(isMobile, 'reflow runs at 320px on its own');
    await page.setViewportSize({ width: 320, height: 800 });
    await open(page, test, { path, status });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const issues = [];
    if (await overflow()) issues.push('Scrolls horizontally at 320px');
    await page.addStyleTag({ content: textSpacing });
    if (await overflow()) issues.push('Scrolls horizontally at 320px with increased text spacing');
    const clipped = await page.evaluate(clippedText);
    record(info, `reflow-${name}`, { path, issues, clipped });
    fail(issues, 'reflow');
  });
}

// WCAG 2.2.2 (and 2.3.3): with reduced motion on, nothing moves on its own for more than 5 seconds
for (const { name, path } of byName(settings.motionPages)) {
  test(`reduced motion: ${name}`, async ({ page, isMobile }, info) => {
    test.skip(isMobile, 'motion checks run on desktop');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, test, { path });
    await page.waitForTimeout(500);
    const { long, smooth } = await page.evaluate(() => ({
      long: document.getAnimations().filter((a) => {
        const t = a.effect?.getComputedTiming?.();
        return a.playState === 'running' && t && (t.iterations === Infinity || t.endTime > 5000);
      }).map((a) => `${a.animationName || a.constructor.name} on ${a.effect?.target?.tagName?.toLowerCase() || '?'}`),
      smooth: getComputedStyle(document.documentElement).scrollBehavior === 'smooth'
    }));
    const issues = long.map((a) => `Keeps moving with reduced motion on: ${a}`);
    const notes = smooth ? ['Smooth scrolling stays on with reduced motion on'] : [];
    record(info, `motion-${name}`, { path, issues, notes });
    fail(issues, 'reduced motion');
  });
}

// Windows High Contrast and other forced colors: screenshots to look at, no assertion
for (const { name, path } of byName(settings.forcedColorsPages)) {
  test(`forced colors: ${name}`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'forced colors screenshots are taken on desktop');
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page, test, { path });
    await page.screenshot({ path: join(results, 'forced-colors', `${name}.png`), fullPage: true });
  });
}
