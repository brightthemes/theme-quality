import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { root, themePackage } from './config.mjs';

// Writes <meta name="ghost-theme" content="Name 1.2.0"> into default.hbs, after the theme-color meta
// the first time. Returns false when default.hbs has neither meta tag.
export function stamp() {
  const file = join(root, 'default.hbs');
  if (!existsSync(file)) return false;
  const pkg = themePackage();
  const name = pkg.displayName || pkg.name.charAt(0).toUpperCase() + pkg.name.slice(1);
  const tag = `<meta name="ghost-theme" content="${name} ${pkg.version}">`;
  const html = readFileSync(file, 'utf8');

  let updated;
  if (html.includes('name="ghost-theme"')) {
    updated = html.replace(/<meta name="ghost-theme" content="[^"]*">/, tag);
  } else {
    updated = html.replace(/^([ \t]*)(<meta name="theme-color" content="[^"]*">)/m, `$1$2\n$1${tag}`);
    if (updated === html) return false;
  }
  writeFileSync(file, updated);
  return true;
}
