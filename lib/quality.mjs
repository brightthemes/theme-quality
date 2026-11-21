import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';
import { loadConfig, readJson, results, root, themePackage } from './config.mjs';
import { run, say } from './run.mjs';
import { browserReady, qualityBin, qualityDeps } from './deps.mjs';
import { defaultPath, demoFile, loadDemo, pickPages } from '../quality/pages.mjs';

const here = join(import.meta.dirname, '..', 'quality');

const devServer = 'http://localhost:2468';

// Smoke, accessibility, HTML validation, Lighthouse and size budget. Returns the failed steps.
// quick: only the accessibility and smoke checks, against a running site (BASE_URL, or the dev server)
export async function quality({ makeZip = true, quick = false } = {}) {
  const config = loadConfig();
  const failures = [];
  qualityDeps();
  if (!await browserReady()) throw new Error('No Chromium for the checks: run `npx theme-tools setup` once (or set CHROMIUM_PATH)');
  rmSync(results, { recursive: true, force: true });
  mkdirSync(results, { recursive: true });

  const data = loadDemo();
  if (!data && !config.quality.pages && !quick) throw new Error(`No ${demoFile}: add the theme's demo content, or list "quality.pages" in theme-tools.json`);
  const fallback = [{ name: 'home', path: '/' }, { name: 'error-404', path: '/this-page-does-not-exist/', status: 404 }];
  const picked = [...(config.quality.pages || (data ? pickPages(data, themePackage()) : fallback)), ...config.quality.extraPages];

  let ghost;
  if (quick) {
    process.env.BASE_URL ||= devServer;
    const up = await fetch(process.env.BASE_URL).then(() => true, () => false);
    if (!up) throw new Error(`Nothing answers on ${process.env.BASE_URL}: start \`npm run dev\` (with Ghost running), or set BASE_URL`);
  } else if (process.env.BASE_URL) {
    run('npm', ['run', 'build', '--silent']);
  } else {
    if (!data) throw new Error(`No ${demoFile}: the test Ghost needs demo content (or set BASE_URL to test a running Ghost)`);
    ghost = await (await import('../quality/ghost.mjs')).startGhost({ config, makeZip });
  }
  const base = process.env.BASE_URL || ghost.url;

  try {
    const pages = [];
    for (const page of picked) pages.push({ ...page, path: ghost ? await ghost.path(page) : page.path || defaultPath(page) });
    writeFileSync(join(results, 'pages.json'), JSON.stringify(pages, null, 2));
    console.log(`\nPages: ${pages.map((p) => `${p.name} ${p.path}`).join(' · ')}`);

    const env = { ...process.env, THEME_ROOT: root, BASE_URL: base, ...(quick ? { THEME_TOOLS_QUICK: '1' } : {}) };
    const step = (name, args, cwd = root) => {
      say(`== ${name}`);
      const { status } = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env });
      if (status !== 0) failures.push(name);
    };
    step(quick ? 'Playwright: accessibility and smoke' : 'Playwright: smoke, accessibility, HTML', [qualityBin('@playwright/test', 'playwright'), 'test', `--config=${join(here, 'playwright.config.mjs')}`]);
    // Run in the results folder, where lhci keeps its .lighthouseci data
    if (!quick) step('Lighthouse', [qualityBin('@lhci/cli', 'lhci'), 'autorun', `--config=${join(here, 'lighthouserc.cjs')}`], results);
  } finally {
    ghost?.stop();
  }

  if (quick) {
    summary(config);
    return failures;
  }

  say('== Size budget (gzipped)');
  const budget = Object.entries(config.quality.budget);
  if (!budget.length) console.log('No budget set ("quality.budget" in theme-tools.json)');
  for (const [file, max] of budget) {
    const path = join(root, file);
    if (!existsSync(path)) { console.log(`✗ ${file}: missing`); failures.push(`budget: ${file}`); continue; }
    const kb = gzipSync(readFileSync(path)).length / 1024;
    const over = kb > max;
    console.log(`${over ? '✗' : '✓'} ${file}: ${kb.toFixed(1)} KB (budget ${max} KB)`);
    if (over && config.quality.enforce) failures.push(`budget: ${file}`);
  }

  summary(config);
  return failures;
}

function summary(config) {
  say('== Summary');
  const findings = join(results, 'findings');
  if (existsSync(findings)) {
    for (const project of readdirSync(findings)) {
      for (const file of readdirSync(join(findings, project))) {
        const f = readJson(join(findings, project, file));
        const axe = Object.entries(f.axe || {})
          .map(([scheme, v]) => `${scheme}: ${v.map((x) => `${x.id} (${x.impact}, ${x.nodes})`).join(', ') || '0'}`)
          .join(' | ');
        const skipped = f.skipped?.length ? ` · skipped: ${f.skipped.join(', ')}` : '';
        const name = `${project}/${file.replace('.json', '')}`;
        if (f.axe) console.log(`${name} · html ${f.html?.length ?? '-'} · axe ${axe}${skipped}`);
        else {
          const notes = [...(f.issues || []), ...(f.notes || []), ...(f.clipped || []).map((c) => `clipped with text spacing: ${c}`)];
          console.log(`${name} · ${f.issues?.length ? `${f.issues.length} issue(s)` : 'ok'}${skipped}${notes.map((n) => `\n    - ${n}`).join('')}`);
        }
      }
    }
  }

  const manifest = join(results, 'lighthouse', 'manifest.json');
  if (existsSync(manifest)) {
    for (const r of readJson(manifest).filter((r) => r.isRepresentativeRun)) {
      const scores = Object.entries(r.summary).map(([k, v]) => `${k} ${Math.round(v * 100)}`).join(' · ');
      console.log(`lighthouse ${new URL(r.url).pathname} · ${scores}`);
    }
  }
  console.log(`\nFull results: quality-results/ (report/index.html, findings/, forced-colors/, lighthouse/)`);
  if (!config.quality.enforce) console.log('Targets are not enforced ("quality.enforce": false in theme-tools.json): only the smoke checks can fail.');
}
