import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadConfig, readJson, results } from '../lib/config.mjs';

export const { quality } = loadConfig();
export const pages = readJson(join(results, 'pages.json'));
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

// Opens a page; in quick mode a page the site doesn't have is skipped instead of failing
export async function open(page, test, { path, status = 200 }) {
  const response = await page.goto(path, { waitUntil: 'networkidle' });
  if (quick && status === 200 && response.status() === 404) test.skip(true, `${path} isn't on this site`);
  return response;
}
