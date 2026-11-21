import { existsSync } from 'fs';
import { join } from 'path';
import { loadConfig, root, themePackage } from './config.mjs';
import { output, run, say } from './run.mjs';
import { stamp } from './stamp.mjs';
import { zip } from './zip.mjs';
import { quality } from './quality.mjs';

const files = ['package.json', 'package-lock.json', 'default.hbs'];

// Bumps the version, stamps default.hbs, zips, runs the quality checks, then commits "vX.Y.Z" and pushes.
// The release workflow publishes the GitHub release from that commit. On a failure the version bump is undone.
export async function release({ bump = 'minor', checks, push = true } = {}) {
  const config = loadConfig();
  if (!['major', 'minor', 'patch'].includes(bump)) throw new Error(`Unknown version bump "${bump}" (major, minor or patch)`);
  if (output('git', ['status', '--porcelain'])) throw new Error('Commit or stash your changes first: the release commit holds only the version bump');

  const from = themePackage().version;
  run('npm', ['version', bump, '--no-git-tag-version', '--silent']);
  const version = themePackage().version;
  const changed = files.filter((f) => existsSync(join(root, f)));
  say(`Releasing ${from} → ${version}`);

  try {
    if (config.release.stamp && !stamp()) console.log('default.hbs has no theme-color or ghost-theme meta tag: version not stamped');
    zip();
    if (checks ?? config.release.quality) {
      const failures = await quality({ makeZip: false });
      if (failures.length) throw new Error(`Quality checks failed: ${failures.join(', ')} (see quality-results/)`);
    }
    run('git', ['add', ...changed]);
    run('git', ['commit', '-m', `v${version}`]);
  } catch (error) {
    // Undo the version bump; a failure here mustn't hide the original error
    for (const args of [['reset', '--quiet', '--', ...changed], ['checkout', '--', ...changed]]) {
      try { output('git', args); } catch (e) { console.error(e.message); }
    }
    throw error;
  }

  // The release commit stays even if the push fails: push it by hand
  if (push) run('git', ['push']);
  say(`✓ v${version}${push ? ' pushed: the release workflow publishes it' : ' committed (not pushed)'}`);
}
