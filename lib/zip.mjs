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

// The demo zip (dist/demo/<name>.zip, same file name so Ghost sees the same theme) keeps the
// templates in demo/ that the demo site's routes use (demo/home-2.hbs…); buyers' zips leave them out
export function zipPath({ demo = false } = {}) {
  return join(root, 'dist', ...(demo ? ['demo'] : []), `${themePackage().name}.zip`);
}

export function zip({ build = true, test = true, demo = false } = {}) {
  const pkg = themePackage();
  if (build && pkg.scripts?.build) run('npm', ['run', 'build', '--silent']);
  if (test) gscan();

  const file = zipPath({ demo });
  mkdirSync(join(file, '..'), { recursive: true });
  // zip -r adds to an existing archive, which would keep deleted files
  rmSync(file, { force: true });
  const exclude = loadConfig().zip.exclude;
  run('zip', ['-rq', file, '.', '-x', ...(demo ? [...exclude.filter((x) => x !== 'demo*'), 'demo/content.json', 'demo/README.md'] : exclude)]);

  const kb = Math.ceil(statSync(file).size / 1024);
  console.log(`\n\x1b[1m\x1b[32m✓\x1b[39m Created ${file.slice(root.length + 1)} (${kb} kB)\x1b[0m`);
  return file;
}
