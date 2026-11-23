import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { Script } from 'vm';
import { root } from './config.mjs';

// Folders that hold no theme templates
const skip = new Set(['node_modules', 'dist', 'quality-results', 'prototypes']);

function templates(dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || skip.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return templates(path);
    return entry.name.endsWith('.hbs') ? [path] : [];
  });
}

// The theme file a script's src points to: {{asset "built/app.js"}} or a literal /assets/…js
function scriptFile(attributes) {
  const asset = attributes.match(/\{\{\s*asset\s+["']([^"']+\.m?js)["']/);
  if (asset) return join('assets', asset[1].replace(/^\//, ''));
  const literal = attributes.match(/\bsrc\s*=\s*["']?(?:\{\{[^}]*\}\})?\/?(assets\/[^"'\s?#{]+\.m?js)/);
  return literal?.[1];
}

// A classic script (no type, or a JavaScript MIME type) runs as a script, not a module.
// Other types (application/ld+json, text/template…) don't run.
function kind(attributes) {
  const type = attributes.match(/\btype\s*=\s*["']?([^"'\s>]*)/)?.[1].toLowerCase();
  if (!type || /^(text|application)\/(x-)?(java|ecma)script$/.test(type)) return 'classic';
  return type === 'module' ? 'module' : null;
}

// Every <script> in the templates that loads a theme file without type="module" must load a
// file that exists and compiles as a classic script: an import or export statement there (a
// bundler's shared chunk, for one) is a syntax error in the browser, and the script doesn't run.
export function checkScripts() {
  const problems = [];
  const checked = new Map();
  for (const template of templates()) {
    const source = readFileSync(template, 'utf8');
    for (const [, attributes] of source.matchAll(/<script\b((?:\{\{[^}]*\}\}|[^>])*)>/gi)) {
      const file = scriptFile(attributes);
      if (!file || kind(attributes) !== 'classic') continue;
      const where = `${relative(root, template)} loads ${file} as a classic script (no type="module")`;
      if (!checked.has(file)) checked.set(file, compile(file));
      const error = checked.get(file);
      if (error) problems.push(`${where}, but ${error}`);
    }
  }
  return { problems, files: [...checked.keys()] };
}

function compile(file) {
  const path = join(root, file);
  if (!existsSync(path)) return 'the file doesn\'t exist (is it in the build?)';
  try {
    new Script(readFileSync(path, 'utf8'), { filename: file });
    return null;
  } catch (error) {
    const line = error.stack?.match(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`))?.[1];
    const why = /import|export/.test(error.message)
      ? 'it has an import or export statement, which only a module can run'
      : 'it doesn\'t compile as a classic script';
    return `${why} (${error.message}${line ? `, line ${line}` : ''}). Load it with type="module", or build it without imports.`;
  }
}

export function scripts() {
  const { problems, files } = checkScripts();
  if (problems.length) {
    throw new Error(`Scripts the browser can't run:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  console.log(`\x1b[32m✓\x1b[0m Classic scripts compile: ${files.length ? files.join(', ') : 'none in the templates'}`);
}
