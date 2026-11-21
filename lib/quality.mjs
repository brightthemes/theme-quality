import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';
import { loadConfig, readJson, results, root, themePackage } from './config.mjs';
import { bin, run, say } from './run.mjs';
import { defaultPath, demoFile, loadDemo, pickPages } from '../quality/pages.mjs';

const here = join(import.meta.dirname, '..', 'quality');

// Smoke, accessibility, HTML validation, Lighthouse and size budget. Returns the failed steps.
export async function quality({ makeZip = true } = {}) {
  const config = loadConfig();
  const failures = [];
  rmSync(results, { recursive: true, force: true });
  mkdirSync(results, { recursive: true });

  const data = loadDemo();
  if (!data && !config.quality.pages) throw new Error(`No ${demoFile}: add the theme's demo content, or list "quality.pages" in theme-tools.json`);
  const picked = [...(config.quality.pages || pickPages(data, themePackage())), ...config.quality.extraPages];

  let ghost;
  if (process.env.BASE_URL) {
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

    const env = { ...process.env, THEME_ROOT: root, BASE_URL: base };
    const step = (name, args, cwd = root) => {
      say(`== ${name}`);
      const { status } = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env });
      if (status !== 0) failures.push(name);
    };
    step('Playwright: smoke, accessibility, HTML', [bin('@playwright/test', 'playwright'), 'test', `--config=${join(here, 'playwright.config.mjs')}`]);
    // Run in the results folder, where lhci keeps its .lighthouseci data
    step('Lighthouse', [bin('@lhci/cli', 'lhci'), 'autorun', `--config=${join(here, 'lighthouserc.cjs')}`], results);
  } finally {
    ghost?.stop();
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
        console.log(`${project}/${file.replace('.json', '')} · html ${f.html?.length ?? '-'} · axe ${axe}${skipped}`);
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
  console.log(`\nFull results: quality-results/ (report/index.html, findings/, lighthouse/)`);
  if (!config.quality.enforce) console.log('Targets are not enforced ("quality.enforce": false in theme-tools.json): only the smoke checks can fail.');
}
