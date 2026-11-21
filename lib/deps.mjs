import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import { bin, run, say } from './run.mjs';

// The quality checks' dependencies (Playwright, Lighthouse, axe, html-validate) live in
// quality/node_modules, installed from quality/package-lock.json on first use. A theme's own
// dependencies and lockfile ship in its zip, so they only carry gscan through theme-tools.
const dir = join(import.meta.dirname, '..', 'quality');
const marker = join(dir, 'node_modules', '.theme-tools-installed');

export function qualityDeps() {
  const lock = createHash('sha256').update(readFileSync(join(dir, 'package-lock.json'))).digest('hex');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === lock) return;
  say('Installing the quality checks\' dependencies (once per theme-tools version)');
  run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir });
  writeFileSync(marker, lock);
}

export const qualityBin = (pkg, name) => bin(pkg, name, join(dir, 'package.json'));

// Playwright's Chromium, unless CHROMIUM_PATH points to another one
export async function browserReady() {
  if (process.env.CHROMIUM_PATH) return existsSync(process.env.CHROMIUM_PATH);
  const { chromium } = createRequire(join(dir, 'package.json'))('@playwright/test');
  return existsSync(chromium.executablePath());
}

// Dependencies and Chromium; withDeps also installs Chromium's system libraries (CI)
export function setup({ withDeps = false } = {}) {
  qualityDeps();
  run(process.execPath, [qualityBin('@playwright/test', 'playwright'), 'install', ...(withDeps ? ['--with-deps'] : []), 'chromium']);
}
