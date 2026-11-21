import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { readJson, root } from '../lib/config.mjs';

export const demoFile = join(root, 'demo', 'content.json');

// A Ghost export has { db: [{ meta, data }] }; older ones are { meta, data }
export function loadDemo() {
  if (!existsSync(demoFile)) return null;
  const json = readJson(demoFile);
  return json.db?.[0]?.data ?? json.data;
}

const size = (p) => (p.lexical || p.mobiledoc || p.html || '').length;
const countBy = (rows = [], key) => rows.reduce((m, r) => m.set(r[key], (m.get(r[key]) || 0) + 1), new Map());
const most = (items, counts) => [...items].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0))[0];
const templateName = (t) => t.replace(/^custom-/, '');

// Whether routes.yaml keeps a collection on "/" (Ghost's default when there's no routes.yaml)
function rootCollection() {
  const file = join(root, 'routes.yaml');
  if (!existsSync(file)) return true;
  const routes = readFileSync(file, 'utf8');
  return /^collections:\s*$[\s\S]*?^\s+\/:\s*$/m.test(routes);
}

// One page per page type and state the demo content has: { name, kind, slug, status }
export function pickPages(data, pkg) {
  const published = data.posts.filter((p) => p.status === 'published');
  const posts = published.filter((p) => (p.type || 'post') === 'post');
  const pages = published.filter((p) => p.type === 'page');
  const publicPosts = posts.filter((p) => !p.visibility || p.visibility === 'public');
  const perPage = Number(pkg.config?.posts_per_page) || 5;
  const picked = [{ name: 'home', path: '/' }];
  const add = (name, kind, item) => item && !picked.some((p) => p.name === name) && picked.push({ name, kind, slug: item.slug });

  if (rootCollection() && posts.length > perPage) picked.push({ name: 'home-page-2', path: '/page/2/' });
  add('post', 'post', [...(publicPosts.length ? publicPosts : posts)].sort((a, b) => size(b) - size(a))[0]);
  add('post-members', 'post', posts.find((p) => p.visibility === 'members'));
  add('post-paid', 'post', posts.find((p) => p.visibility === 'paid' || p.visibility === 'tiers'));
  for (const p of posts.filter((p) => p.custom_template)) add(`post-${templateName(p.custom_template)}`, 'post', p);
  add('page', 'page', pages.find((p) => !p.custom_template));
  for (const p of pages.filter((p) => p.custom_template)) add(`page-${templateName(p.custom_template)}`, 'page', p);

  const tags = (data.tags || []).filter((t) => !t.slug.startsWith('hash-') && t.visibility !== 'internal');
  add('tag', 'tag', most(tags, countBy(data.posts_tags, 'tag_id')));
  add('author', 'author', most(data.users || [], countBy(data.posts_authors, 'author_id')));

  picked.push({ name: 'error-404', path: '/this-page-does-not-exist/', status: 404 });
  return picked;
}

// Ghost's default URLs, for a Ghost the tests didn't set up (BASE_URL)
export const defaultPath = ({ kind, slug }) => ({ tag: `/tag/${slug}/`, author: `/author/${slug}/` })[kind] || `/${slug}/`;
