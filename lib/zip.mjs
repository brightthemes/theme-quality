import { mkdirSync, realpathSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { loadConfig, root, themePackage } from './config.mjs';
import { bin, run } from './run.mjs';

// gscan treats a theme under the system temp folder as an unpacked zip and deletes .git,
// node_modules, AGENTS.md and CLAUDE.md from it (following symlinks), so it never runs there
export function gscan() {
  const temp = realpathSync(tmpdir()) + sep;
  if ((realpathSync(root) + sep).startsWith(temp)) {
    throw new Error(`The theme is under the temp folder (${temp}): gscan would delete its .git and node_modules. Move it elsewhere.`);
  }
  run(process.execPath, [bin('gscan'), '.', '--verbose']);
}

export function zipPath() {
  return join(root, 'dist', `${themePackage().name}.zip`);
}

export function zip({ build = true, test = true } = {}) {
  const pkg = themePackage();
  if (build && pkg.scripts?.build) run('npm', ['run', 'build', '--silent']);
  if (test) gscan();

  const file = zipPath();
  mkdirSync(join(root, 'dist'), { recursive: true });
  // zip -r adds to an existing archive, which would keep deleted files
  rmSync(file, { force: true });
  run('zip', ['-rq', file, '.', '-x', ...loadConfig().zip.exclude]);

  const kb = Math.ceil(statSync(file).size / 1024);
  console.log(`\n\x1b[1m\x1b[32m✓\x1b[39m Created dist/${pkg.name}.zip (${kb} kB)\x1b[0m`);
  return file;
}
