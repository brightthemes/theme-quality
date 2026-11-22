import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { results, root, themePackage } from '../lib/config.mjs';
import { zip, zipPath } from '../lib/zip.mjs';
import { demoFile } from './pages.mjs';

const port = Number(process.env.GHOST_PORT || 2369);
const url = `http://localhost:${port}`;
const run = (command, cwd) => execSync(command, { cwd, stdio: 'inherit' });
const log = (message) => console.log(`[ghost] ${message}`);

// Not under the system temp folder: gscan deletes files from themes it finds there
const ghostDir = process.env.GHOST_DIR || join(homedir(), '.cache', 'ghost-theme-tests');

// A throwaway Ghost with the theme zip and demo/content.json. Returns { url, stop, path }:
// path(page) gives a picked page's URL path as Ghost (and the theme's routes.yaml) builds it.
export async function startGhost({ config, makeZip = true }) {
  const theme = themePackage().name;
  const version = process.env.GHOST_VERSION || [].concat(JSON.parse(execSync('npm view ghost@6 version --json'))).at(-1);
  const app = join(ghostDir, version);

  if (!existsSync(join(app, 'node_modules'))) {
    log(`installing Ghost ${version} in ${app}`);
    rmSync(app, { recursive: true, force: true });
    mkdirSync(app, { recursive: true });
    run(`npm pack ghost@${version} --silent && tar -xzf ghost-${version}.tgz --strip-components=1 && rm ghost-${version}.tgz`, app);
    const pnpm = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).packageManager?.split('+')[0] || 'pnpm';
    run(`npx -y ${pnpm} install --prod --frozen-lockfile --reporter=silent`, app);
  }

  // Fresh database and theme on every run
  rmSync(join(app, 'content', 'data'), { recursive: true, force: true });
  mkdirSync(join(app, 'content', 'data'), { recursive: true });
  writeFileSync(join(app, 'config.production.json'), JSON.stringify({
    url,
    server: { host: '127.0.0.1', port },
    database: { client: 'better-sqlite3', connection: { filename: 'content/data/ghost-test.db' } },
    mail: { transport: 'stub' },
    logging: { level: 'warn', transports: ['stdout'] }
  }, null, 2));

  if (makeZip || !existsSync(zipPath())) {
    log('building the theme zip');
    zip();
  }
  const themeDir = join(app, 'content', 'themes', theme);
  rmSync(themeDir, { recursive: true, force: true });
  mkdirSync(themeDir, { recursive: true });
  run(`unzip -q ${zipPath()} -d ${themeDir}`);

  log(`starting Ghost ${version} on ${url}`);
  const ghost = spawn('node', ['index.js'], { cwd: app, env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  ghost.stdout.on('data', (d) => output.push(String(d)));
  ghost.stderr.on('data', (d) => output.push(String(d)));
  const stop = () => ghost.kill();

  try {
    const path = await setup(theme, { ...config.quality.ghost, member: config.quality.members.enabled });
    return { url, stop, path };
  } catch (error) {
    stop();
    console.error(output.join('').slice(-4000));
    throw error;
  }
}

async function setup(theme, options) {
  const api = `${url}/ghost/api/admin`;
  const headers = { 'Content-Type': 'application/json', Origin: url, 'Accept-Version': 'v6.0' };
  const call = async (method, path, body, retries = 30) => {
    for (let i = 0; ; i++) {
      const res = await fetch(api + path, { method, headers, body: body && (body instanceof FormData ? body : JSON.stringify(body)) }).catch(() => null);
      if (res && res.ok) return res;
      if (i >= retries) throw new Error(`${method} ${path}: ${res ? `${res.status} ${await res.text()}` : 'no response'}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  };
  const upload = async (method, path, field, file, type) => {
    const form = new FormData();
    form.append(field, new Blob([file.content ?? readFileSync(file)], { type }), field === 'routes' ? 'routes.yaml' : 'content.json');
    delete headers['Content-Type'];
    try { await call(method, path, form); } finally { headers['Content-Type'] = 'application/json'; }
  };

  await call('GET', '/site/', null, 120);
  const password = randomBytes(16).toString('base64url');
  await call('POST', '/authentication/setup/', { setup: [{ name: 'Site Owner', email: 'owner@example.com', password, blogTitle: 'Theme Tests' }] });
  const session = await call('POST', '/session/', { username: 'owner@example.com', password });
  headers.Cookie = session.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  await call('PUT', `/themes/${theme}/activate/`);
  // Remove Ghost's starter posts and pages so only the demo content is there
  await call('DELETE', '/db/');
  const content = await localImages(call, headers, readFileSync(demoFile, 'utf8'));
  log('importing demo/content.json');
  await upload('POST', '/db/', 'importfile', { content }, 'application/json');

  const routes = join(root, 'routes.yaml');
  if (options.routes && existsSync(routes)) {
    log('uploading routes.yaml');
    await upload('POST', '/settings/routes/yaml/', 'routes', routes, 'application/yaml');
  }

  const resources = { post: 'posts', page: 'pages', tag: 'tags', author: 'users' };
  const urls = new Map();
  const path = async (page) => {
    if (page.path) return page.path;
    const key = `${page.kind}:${page.slug}`;
    if (!urls.has(key)) {
      const res = await call('GET', `/${resources[page.kind]}/slug/${page.slug}/`, null, 0);
      const [item] = Object.values(await res.json())[0];
      urls.set(key, { path: new URL(item.url).pathname, title: item.title || item.name });
    }
    return urls.get(key).path;
  };

  // Navigation isn't part of a content import. The default has a dropdown ("-" items), as Skeleton builds them.
  const navigation = options.navigation || await defaultNavigation(path, urls);
  // Ghost's default cover image is on static.ghost.org, which Ghost can't resize
  const settings = (await (await call('GET', '/settings/')).json()).settings;
  const cover = settings.find((s) => s.key === 'cover_image')?.value;
  const localCover = cover && (await uploadImages(call, headers, [cover])).get(cover);
  await call('PUT', '/settings/', { settings: [
    { key: 'navigation', value: JSON.stringify(navigation) },
    ...(localCover ? [{ key: 'cover_image', value: localCover }] : []),
    // Ghost's default accent (pink) fails contrast with any text color
    ...(options.accentColor ? [{ key: 'accent_color', value: options.accentColor }] : [])
  ] });
  if (options.member !== false) await setupMember(call);
  log('ready');
  return path;
}

// A second newsletter, custom fields (Ghost 6.78+) and a member with a sign-in link, for the
// signed-in checks (quality/members.spec.mjs). The link is used once, by quality/member-setup.mjs.
async function setupMember(call) {
  const json = (res) => res.json();
  await call('POST', '/newsletters/', { newsletters: [{ name: 'Weekly digest', description: 'The week in one email' }] }, 0).catch(() => null);
  const newsletters = (await call('GET', '/newsletters/?limit=50', null, 0).then(json)).newsletters;

  let fields = [];
  try {
    await call('POST', '/members/metafields/custom/', { members_metafields: [
      { name: 'Company', type: 'short_text', access: { member: 'write' } },
      { name: 'Topics', type: 'list', settings: { options: ['Design', 'Code', 'Business'], multiple: true }, access: { member: 'write' } },
      { name: 'Shipping address', type: 'address', access: { member: 'write' } },
      { name: 'Member number', type: 'short_text', access: { member: 'read' } }
    ] }, 0);
    fields = (await call('GET', '/members/metafields/custom/', null, 0).then(json)).members_metafields
      .map(({ key, name, type, access }) => ({ key, name, type, access: access.member }));
  } catch {
    log('no custom fields on this Ghost version');
  }
  const readOnly = fields.find((f) => f.access === 'read');

  const member = (await call('POST', '/members/', { members: [{
    email: 'reader@example.com',
    name: "Reader O'Brien",
    newsletters: [{ id: newsletters[0].id }],
    ...(readOnly ? { metafields: { custom: { [readOnly.key]: 'A-1001' } } } : {})
  }] }, 0).then(json)).members[0];
  const signinUrl = (await call('GET', `/members/${member.id}/signin_urls/`, null, 0).then(json)).member_signin_urls[0].url;

  mkdirSync(results, { recursive: true });
  writeFileSync(join(results, 'member.json'), JSON.stringify({
    email: member.email, name: member.name, signinUrl, newsletters: newsletters.length, fields
  }, null, 2));
  log(`member ${member.email}: ${newsletters.length} newsletters, ${fields.length} custom fields`);
}

async function defaultNavigation(path, urls) {
  const { loadDemo } = await import('./pages.mjs');
  const data = loadDemo();
  const page = data.posts.find((p) => p.type === 'page' && p.status === 'published' && !p.custom_template);
  const tag = (data.tags || []).find((t) => !t.slug.startsWith('hash-'));
  const items = [{ label: 'Home', url: '/' }];
  const link = async (kind, item, prefix = '') => {
    if (!item) return;
    const url = await path({ kind, slug: item.slug });
    items.push({ label: prefix + urls.get(`${kind}:${item.slug}`).title, url });
  };
  await link('page', page);
  for (const user of (data.users || []).slice(0, 2)) await link('author', user, '-');
  await link('tag', tag);
  return items;
}

// The demo's images are on other hosts (picsum.photos), which Ghost doesn't resize, so Lighthouse
// would measure full-size images no real site serves. They're uploaded to the test Ghost instead,
// as a publisher's would be, and cached between runs. Unsplash stays: Ghost resizes it by URL.
const externalImage = /https?:\/\/(?:[a-z0-9-]+\.)*(?:picsum\.photos\/[^"\\\s)]+|(?!(?:images\.)?unsplash\.com)[a-z0-9.-]+\/[^"\\\s)]+\.(?:jpe?g|png|webp|gif|avif))/gi;

async function localImages(call, headers, json) {
  const found = [...new Set(json.match(externalImage) || [])].filter((u) => !u.startsWith(url));
  if (!found.length) return json;
  const local = await uploadImages(call, headers, found);
  for (const [from, to] of local) json = json.split(from).join(to);
  log(`demo images: ${local.size} of ${found.length} uploaded`);
  return json;
}

async function uploadImages(call, headers, urls) {
  const cache = join(ghostDir, 'images');
  mkdirSync(cache, { recursive: true });
  const local = new Map();
  const one = async (src) => {
    if (src.startsWith(url) || /unsplash\.com/.test(src)) return;
    const name = createHash('sha1').update(src).digest('hex').slice(0, 16);
    let file = readdirSync(cache).find((f) => f.startsWith(name + '.'));
    if (!file) {
      const res = await fetch(src).catch(() => null);
      if (!res?.ok) return log(`couldn't download ${src}, it stays external`);
      const type = res.headers.get('content-type') || 'image/jpeg';
      file = `${name}.${type.split('/')[1].split(/[;+]/)[0].replace('jpeg', 'jpg')}`;
      writeFileSync(join(cache, file), Buffer.from(await res.arrayBuffer()));
    }
    const form = new FormData();
    const ext = file.split('.').pop();
    form.append('file', new Blob([readFileSync(join(cache, file))], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }), file);
    form.append('purpose', 'image');
    const type = headers['Content-Type'];
    delete headers['Content-Type'];
    try {
      const res = await call('POST', '/images/upload/', form, 2);
      local.set(src, (await res.json()).images[0].url);
    } catch { log(`couldn't upload ${src}, it stays external`); }
    finally { headers['Content-Type'] = type; }
  };
  for (let i = 0; i < urls.length; i += 6) await Promise.all(urls.slice(i, i + 6).map(one));
  return local;
}
