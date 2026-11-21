import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { root } from './config.mjs';

const require = createRequire(import.meta.url);

export class CommandError extends Error {}

// Runs a command in the theme folder and throws when it fails
export function run(command, args, options = {}) {
  const { status, error } = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (error) throw error;
  if (status !== 0) throw new CommandError(`${[command, ...args].join(' ')} exited with ${status}`);
}

// A command's output; throws when it fails
export function output(command, args) {
  const { status, stdout, stderr, error } = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (error) throw error;
  if (status !== 0) throw new CommandError(`${[command, ...args].join(' ')} exited with ${status}: ${stderr.trim()}`);
  return stdout.trim();
}

// A dependency's executable, so the theme doesn't need it in its own package.json
export function bin(pkg, name = pkg.split('/').at(-1)) {
  const manifest = require.resolve(`${pkg}/package.json`);
  const { bin } = require(manifest);
  return join(dirname(manifest), typeof bin === 'string' ? bin : bin[name]);
}

export const say = (message) => console.log(`\n\x1b[1m${message}\x1b[0m`);
