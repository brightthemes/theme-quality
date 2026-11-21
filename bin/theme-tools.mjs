#!/usr/bin/env node
import { CommandError } from '../lib/run.mjs';

const help = `theme-tools: dev tooling for Bright Themes' Ghost themes (run in a theme's folder)

  theme-tools test                      gscan, Ghost's theme validator
  theme-tools zip [--no-build]          build, gscan, and zip the theme into dist/
  theme-tools stamp                     write the version into default.hbs (<meta name="ghost-theme">)
  theme-tools quality [--no-zip]        smoke, accessibility, HTML, Lighthouse and size checks on a
                                        throwaway Ghost with demo/content.json (BASE_URL: a running Ghost)
  theme-tools release [minor|patch|major] [--no-quality] [--no-push]
                                        bump, stamp, zip, quality checks, commit "vX.Y.Z" and push

Settings: theme-tools.json in the theme (see the README).`;

const [command, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);

try {
  switch (command) {
    case 'test':
      (await import('../lib/zip.mjs')).gscan();
      break;
    case 'zip':
      (await import('../lib/zip.mjs')).zip({ build: !flag('--no-build') });
      break;
    case 'stamp': {
      const stamped = (await import('../lib/stamp.mjs')).stamp();
      console.log(stamped ? 'Stamped default.hbs' : 'default.hbs has no theme-color or ghost-theme meta tag: nothing stamped');
      break;
    }
    case 'quality': {
      const failures = await (await import('../lib/quality.mjs')).quality({ makeZip: !flag('--no-zip') });
      if (failures.length) {
        console.error(`\nFailed: ${failures.join(', ')}`);
        process.exitCode = 1;
      }
      break;
    }
    case 'release':
      await (await import('../lib/release.mjs')).release({
        bump: args.find((a) => !a.startsWith('-')) || 'minor',
        checks: flag('--no-quality') ? false : undefined,
        push: !flag('--no-push')
      });
      break;
    default:
      console.log(help);
      if (command && !['help', '--help', '-h'].includes(command)) process.exitCode = 1;
  }
} catch (error) {
  console.error(`\n\x1b[31m✗ ${error.message}\x1b[0m`);
  if (!(error instanceof CommandError) && process.env.DEBUG) console.error(error);
  process.exitCode = 1;
}
