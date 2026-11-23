import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { loadConfig, root } from './config.mjs';

// The standard for templates, pages and routes (Skeleton's DEVELOPMENT.md, "Templates, pages and
// routes"), checked on the files: a page with a custom template by default, a route only for a
// collection, a paginated channel, a feed or a static home; custom templates named for what they're
// for; demo files in demo/; pages the templates read by slug named home-* or section-*.
// A sold theme keeps its older names (posts and buyers' routes.yaml store them): each one is
// listed in theme-tools.json under structure.allow, with a reason.

// Ghost's own templates (https://ghost.org/docs/themes/structure/)
const ghostTemplates = /^(default|index|home|post|page|tag|author|error|error-\d{3}|error-[45]xx)\.hbs$/;
const customTemplate = /^custom-(post|template)-[a-z0-9-]+\.hbs$/;
const slugTemplate = /^(page|post|tag|author)-[a-z0-9-]+\.hbs$/;
const sectionSlug = /^(home|section)-[a-z0-9-]+$/;
const demoRoutes = 'routes-demo.yaml';

// Folders that hold no theme templates (partials/ holds partials, demo/ the demo site's templates)
const skip = new Set(['node_modules', 'dist', 'quality-results', 'prototypes', 'tests', 'scripts', 'partials', 'demo']);

function hbsFiles(dir, { into = () => true } = {}) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return into(entry.name) ? hbsFiles(path, { into }) : [];
    return entry.name.endsWith('.hbs') ? [path] : [];
  });
}

// routes.yaml is a small, fixed shape: three sections of paths, each a template name (the short
// form) or a map of single-line values. Enough of YAML to read it, without a dependency.
export function parseRoutes(source) {
  const sections = {};
  let section = null;
  let path = null;
  for (const raw of source.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const [, key, value = ''] = line.trim().match(/^([^:]+(?::(?!\s|$)[^:]*)*):\s*(.*)$/) || [];
    if (key === undefined) continue;
    if (indent === 0) {
      section = key;
      sections[section] = {};
      path = null;
    } else if (section && (path === null || indent <= sections[section][path].indent)) {
      path = key;
      sections[section][path] = { indent, value: value || null, keys: {} };
    } else if (section && path) {
      sections[section][path].keys[key] = value;
    }
  }
  return sections;
}

function readRoutes(file, problems) {
  if (!existsSync(join(root, file))) return null;
  const sections = parseRoutes(readFileSync(join(root, file), 'utf8'));
  const entries = [];
  for (const section of ['routes', 'collections']) {
    for (const [path, entry] of Object.entries(sections[section] || {})) {
      if (entry.value) {
        problems.push({ path: `${file} ${path}`, message: `${file}: ${path} uses the short form (${path}: ${entry.value}); write it with template: ${entry.value}` });
      }
      entries.push({ section, path, template: entry.value || entry.keys.template, keys: entry.keys });
    }
  }
  return entries;
}

export function checkStructure() {
  const problems = [];
  const routeTemplates = new Set();

  // routes.yaml: what each route is, and that its templates exist
  if (!existsSync(join(root, 'routes.yaml'))) {
    problems.push({ path: 'routes.yaml', message: 'routes.yaml is missing: ship Ghost\'s default one, so uploading it resets a site\'s routes' });
  }
  const routes = readRoutes('routes.yaml', problems) || [];
  const homeCollection = routes.some((r) => r.section === 'collections' && r.path === '/');
  for (const route of routes) {
    if (route.template) routeTemplates.add(`${route.template}.hbs`);
    if (route.template && !existsSync(join(root, `${route.template}.hbs`))) {
      problems.push({ path: route.path, message: `routes.yaml: ${route.path} uses ${route.template}.hbs, which doesn't exist` });
    }
    if (route.template && slugTemplate.test(`${route.template}.hbs`)) {
      problems.push({ path: `${route.template}.hbs`, message: `routes.yaml: ${route.path} uses ${route.template}.hbs, a slug template's name (Ghost also uses it for the page with that slug): name it after the route` });
    }
    if (route.template && route.template.includes('/')) {
      problems.push({ path: route.path, message: `routes.yaml: ${route.path} uses ${route.template}.hbs, in a folder: templates go at the theme's root` });
    }
    if (route.section !== 'routes') continue;
    const channel = route.keys.controller === 'channel';
    const feed = 'content_type' in route.keys;
    const staticHome = route.path === '/' && !homeCollection;
    if (!channel && !feed && !staticHome) {
      problems.push({ path: route.path, message: `routes.yaml: ${route.path} is a route for a single page: make it a page with a custom-template-* template (routes are for collections, paginated channels, feeds and a static home)` });
    }
    if (route.path === '/' && homeCollection) {
      problems.push({ path: route.path, message: 'routes.yaml: a / route next to a collection on /: home.hbs already shows on the first page of /' });
    }
  }

  // Templates at the root: Ghost's own, custom templates, and the ones routes.yaml uses
  for (const file of readdirSync(root).filter((f) => f.endsWith('.hbs'))) {
    if (ghostTemplates.test(file) || customTemplate.test(file) || routeTemplates.has(file)) continue;
    let message;
    if (file === 'private.hbs') message = 'private.hbs: theme-tools leaves it out of the zip, so Ghost\'s own password page shows: delete it';
    else if (slugTemplate.test(file)) message = `${file} is a slug template (Ghost uses it for one slug only): make it a custom-template-* page template`;
    else if (file.startsWith('custom-')) message = `${file}: name custom templates custom-post-<name>.hbs (posts) or custom-template-<name>.hbs (pages), since Ghost lists every custom template for both`;
    else if (/^(demo|index\d|home\d)/.test(file)) message = `${file} is a demo template: move it to demo/ (demo/home-2.hbs…), which only the demo zip keeps`;
    else message = `${file} isn't a Ghost template, a custom template or a template routes.yaml uses`;
    problems.push({ path: file, message });
  }

  // Templates in folders other than partials/ and demo/
  for (const file of hbsFiles(root, { into: (name) => !skip.has(name) }).filter((f) => relative(root, f).includes('/'))) {
    const folder = relative(root, file).split('/')[0];
    if (problems.some((p) => p.path === `${folder}/`)) continue;
    problems.push({ path: `${folder}/`, message: `${folder}/ holds templates: templates go at the theme's root, partials in partials/, demo templates in demo/` });
  }

  // Demo files: in demo/, with one routes file name
  for (const file of readdirSync(root).filter((f) => /^demo[-_.]/.test(f) && !f.endsWith('.hbs'))) {
    problems.push({ path: file, message: `${file}: demo files go in demo/ (the demo routes in demo/${demoRoutes})` });
  }
  for (const file of existsSync(join(root, 'demo')) ? readdirSync(join(root, 'demo')).filter((f) => /\.ya?ml$/.test(f) && f !== demoRoutes) : []) {
    problems.push({ path: `demo/${file}`, message: `demo/${file}: name the demo site's routes demo/${demoRoutes}` });
  }
  for (const route of readRoutes(`demo/${demoRoutes}`, problems) || []) {
    if (route.template && !existsSync(join(root, `${route.template}.hbs`))) {
      problems.push({ path: `demo ${route.path}`, message: `demo/${demoRoutes}: ${route.path} uses ${route.template}.hbs, which doesn't exist` });
    }
  }

  // Pages the templates read by slug: home-* (home page sections) or section-* (the rest)
  const slugs = new Map();
  for (const file of hbsFiles(root, { into: (name) => !['node_modules', 'dist', 'quality-results', 'prototypes', 'demo'].includes(name) })) {
    const source = readFileSync(file, 'utf8');
    for (const [tag] of source.matchAll(/\{\{#get\s+["']pages["'][^}]*\}\}/g)) {
      const filter = tag.match(/filter\s*=\s*["']([^"']*)["']/)?.[1] || '';
      for (const [, list] of filter.matchAll(/slug:\s*(\[[^\]]*\]|[^+,\s]+)/g)) {
        for (const slug of list.replace(/[[\]]/g, '').split(',').map((s) => s.trim())) {
          if (!slug || slug.includes('{{') || sectionSlug.test(slug)) continue;
          if (!slugs.has(slug)) slugs.set(slug, relative(root, file));
        }
      }
    }
  }
  for (const [slug, file] of slugs) {
    problems.push({ path: `slug:${slug}`, message: `${file} reads the page "${slug}": name pages the theme reads home-<name> (home page sections) or section-<name> (everything else)` });
  }

  return problems;
}

// An allow entry's path matches a problem's path exactly, or with * for any characters
// (custom-with-*.hbs for a theme's older post templates)
const matches = (pattern, path) => new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`).test(path);

export function structure() {
  const allow = loadConfig().structure.allow;
  const unexplained = allow.filter((a) => !a.path || !a.reason);
  if (unexplained.length) {
    throw new Error(`theme-tools.json: every structure.allow entry needs a path and a reason:\n${unexplained.map((a) => `  - ${JSON.stringify(a)}`).join('\n')}`);
  }
  const problems = checkStructure();
  const failing = problems.filter((p) => !allow.some((a) => matches(a.path, p.path)));
  const unused = allow.filter((a) => !problems.some((p) => matches(a.path, p.path)));
  for (const a of unused) console.log(`\x1b[33m!\x1b[0m structure.allow lists ${a.path}, which now follows the standard: remove it from theme-tools.json`);
  if (failing.length) {
    throw new Error(`Templates, pages and routes that don't follow the standard (Skeleton's DEVELOPMENT.md, "Templates, pages and routes"):\n${failing.map((p) => `  - ${p.message}`).join('\n')}\nA sold theme keeps an older name in theme-tools.json: { "structure": { "allow": [{ "path": "…", "reason": "…" }] } }`);
  }
  const kept = problems.length - failing.length;
  console.log(`\x1b[32m✓\x1b[0m Templates, pages and routes follow the standard${kept ? ` (${kept} older name${kept === 1 ? '' : 's'} kept, listed in theme-tools.json)` : ''}`);
}
