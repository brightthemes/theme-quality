import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { root } from './config.mjs';
import { CommandError } from './run.mjs';

// Sets up the demo site after a deploy: runs demo/pages.mjs (the pages the page templates run on, each
// with its template) and uploads demo/routes-demo.yaml (the demo home pages and the theme's collections).
// Each step runs only when the theme has the file. GHOST_URL and ADMIN_API_KEY (id:secret, from a custom
// integration) name the site, the same values the deploy uses. Ghost takes a routes upload only from a
// signed-in staff user, not from an integration, so the routes go up only with GHOST_EMAIL and
// GHOST_PASSWORD too (a staff user; Ghost's staff device verification has to be off for a sign-in from CI).
export async function demo() {
  const url = (process.env.GHOST_URL || '').replace(/\/$/, '').replace(/\/ghost(\/api.*)?$/, '');
  const key = process.env.ADMIN_API_KEY || '';
  const [id, secret] = key.split(':');
  if (!url || !(id && secret)) throw new CommandError('Set GHOST_URL and ADMIN_API_KEY (id:secret).');

  const routes = join(root, 'demo', 'routes-demo.yaml');
  const pages = join(root, 'demo', 'pages.mjs');
  if (!existsSync(routes) && !existsSync(pages)) {
    console.log('No demo/routes-demo.yaml or demo/pages.mjs: nothing to set up');
    return;
  }

  if (existsSync(pages)) {
    console.log('Running demo/pages.mjs');
    // The integration key only: pages.mjs signs in with GHOST_EMAIL and GHOST_PASSWORD when there's no key
    const { GHOST_EMAIL, GHOST_PASSWORD, ...env } = process.env;
    execFileSync(process.execPath, [pages], { cwd: root, stdio: 'inherit', env: { ...env, GHOST_URL: url, ADMIN_API_KEY: key } });
  }

  if (existsSync(routes)) {
    const { GHOST_EMAIL: email, GHOST_PASSWORD: password } = process.env;
    if (!(email && password)) {
      console.log('demo/routes-demo.yaml not uploaded: Ghost takes routes only from a staff user (set GHOST_EMAIL and GHOST_PASSWORD).\n' +
        'Upload it in Settings › Advanced › Labs › Routes when it changes.');
      return;
    }
    const headers = { Origin: url, 'Accept-Version': 'v6.0' };
    const session = await fetch(`${url}/ghost/api/admin/session/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password })
    });
    if (!session.ok) throw new CommandError(`Signing in as GHOST_EMAIL: ${session.status} ${(await session.text()).slice(0, 300)}`);
    headers.Cookie = session.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const form = new FormData();
    form.append('routes', new Blob([readFileSync(routes)], { type: 'application/yaml' }), 'routes.yaml');
    const res = await fetch(`${url}/ghost/api/admin/settings/routes/yaml/`, { method: 'POST', headers, body: form });
    if (!res.ok) throw new CommandError(`Uploading demo/routes-demo.yaml: ${res.status} ${(await res.text()).slice(0, 300)}`);
    console.log('Uploaded demo/routes-demo.yaml');
  }
}
