#!/usr/bin/env node
/**
 * Refuse to deploy a build that would take live posts offline.
 *
 * Wired at the end of `build` (Jenkins runs `npm run build` then wrangler —
 * it never runs `npm run deploy`):
 *
 *   "build": "… && astro build && node scripts/guard-deploy.mjs"
 *
 * Override deliberately with ALLOW_CONTENT_LOSS=1 only when loss is intentional.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const asJson = process.argv.includes('--json');
const allowLoss = process.env.ALLOW_CONTENT_LOSS === '1';
const CONTENT = 'src/data/content.json';
const SPAM_FILE = 'src/data/spam-slugs.json';

function siteOrigin() {
  for (const f of ['astro.config.mjs', 'astro.config.ts']) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, 'utf8').match(/site:\s*['"](https?:\/\/[^'"]+)['"]/);
    if (m) return m[1].replace(/\/+$/, '');
  }
  return null;
}

function builtRoutes(dir = 'dist', base = '') {
  const out = new Set();
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      for (const r of builtRoutes(join(dir, e.name), `${base}/${e.name}`)) out.add(r);
    } else if (e.name === 'index.html') {
      out.add(base === '' ? '/' : `${base}/`);
    }
  }
  return out;
}

function spamSlugSet() {
  if (!existsSync(SPAM_FILE)) return new Set();
  const raw = JSON.parse(readFileSync(SPAM_FILE, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.slugs || [];
  return new Set(list.map(String));
}

/**
 * Intentional spam takedown: slug listed in spam-slugs.json while still in content.json.
 */
function isIntentionalSpamDrop(urlPath) {
  const slug = urlPath.replace(/^\/+|\/+$/g, '').split('/').pop();
  if (!slug) return false;
  if (!spamSlugSet().has(slug)) return false;
  if (!existsSync(CONTENT)) return true;
  try {
    const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
    return (data.posts || []).some((p) => p?.slug === slug);
  } catch {
    return true;
  }
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

const origin = siteOrigin();
if (!origin) {
  console.log('[guard-deploy] no `site` in astro.config — cannot compare against live, skipping');
  process.exit(0);
}

const built = builtRoutes();
if (built.size === 0) {
  console.error('[guard-deploy] dist/ is empty — build before deploying');
  process.exit(1);
}

const CANDIDATES = ['/blog/', '/blogs/', '/artikelen/', '/category/blog/', '/laatste-berichten/', '/'];
const MAX_LISTING_PAGES = 80;

function paginationPattern(base) {
  const prefix = base === '/' ? '' : base.replace(/\/+$/, '');
  const target = `(?:https?://[^/"'\\s>]+)?(${prefix}/(?:page/)?\\d+/?)`;
  return new RegExp(`href=(?:"${target}"|'${target}'|${target}(?=[\\s>]))`, 'gi');
}

let html = '';
const crawled = new Set();
let reachedAny = false;

for (const candidate of CANDIDATES) {
  const first = await fetchText(origin + candidate);
  if (!first) continue;
  reachedAny = true;
  const pattern = paginationPattern(candidate);
  const queue = [];
  const enqueue = (body) => {
    for (const m of body.matchAll(pattern)) {
      const raw = m[1] ?? m[2] ?? m[3];
      if (!raw) continue;
      const path = raw.endsWith('/') ? raw : `${raw}/`;
      if (!crawled.has(path) && crawled.size < MAX_LISTING_PAGES) {
        crawled.add(path);
        queue.push(path);
      }
    }
  };
  crawled.add(candidate);
  html += first;
  enqueue(first);
  while (queue.length > 0) {
    const body = await fetchText(origin + queue.shift());
    html += body;
    enqueue(body);
  }
}

if (!reachedAny) {
  console.error(`[guard-deploy] could not reach ${origin} — refusing to deploy blind`);
  process.exit(1);
}
if (crawled.size >= MAX_LISTING_PAGES) {
  console.log(`[guard-deploy] stopped at ${MAX_LISTING_PAGES} listing pages — deeper pages not checked`);
}
console.log(`[guard-deploy] crawled ${crawled.size} listing page(s) on ${origin}`);

const liveLinks = new Set();
const SEG = '[a-z0-9][a-z0-9-]{2,}';
const TARGET = `(?:https?://[^/"'\\s>]+)?(/${SEG}/?(?:[a-z0-9][a-z0-9-]{4,}/?)?)`;
const ARTICLE_LINK = new RegExp(
  `href=(?:"${TARGET}"|'${TARGET}'|${TARGET}(?=[\\s>]))`,
  'gi',
);
for (const m of html.matchAll(ARTICLE_LINK)) {
  const raw = m[1] ?? m[2] ?? m[3];
  if (!raw) continue;
  const path = raw.endsWith('/') ? raw : `${raw}/`;
  if (/\/(?:page\/)?\d+\/$/.test(path)) continue;
  liveLinks.add(path);
}

const candidates = [...liveLinks].filter((u) => !built.has(u)).sort();
const missing = [];
const alreadyDead = [];
const spamDrops = [];
for (const u of candidates) {
  if (isIntentionalSpamDrop(u)) {
    spamDrops.push(u);
    continue;
  }
  let ok = false;
  try {
    const res = await fetch(origin + u, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    ok = res.ok;
  } catch {
    ok = false;
  }
  (ok ? missing : alreadyDead).push(u);
}
if (spamDrops.length > 0) {
  console.log(
    `[guard-deploy] allowing ${spamDrops.length} intentional spam drop(s): ` +
      spamDrops.slice(0, 5).join(', ') + (spamDrops.length > 5 ? ' …' : ''),
  );
}
if (alreadyDead.length > 0) {
  console.log(
    `[guard-deploy] ignoring ${alreadyDead.length} listing link(s) that already 404 live: ` +
      alreadyDead.slice(0, 5).join(', ') + (alreadyDead.length > 5 ? ' …' : ''),
  );
}

if (asJson) {
  console.log(JSON.stringify({ origin, listings: [...crawled], live: liveLinks.size, built: built.size, missing }, null, 2));
}

if (missing.length === 0) {
  console.log(`[guard-deploy] OK — all ${liveLinks.size} live URL(s) exist in dist/ (${built.size} routes)`);
  process.exit(0);
}

console.error(`\n[guard-deploy] ${missing.length} live URL(s) are NOT in this build:`);
for (const u of missing.slice(0, 40)) console.error(`  · ${origin}${u}`);
if (missing.length > 40) console.error(`  … and ${missing.length - 40} more`);

if (allowLoss) {
  console.error('\nALLOW_CONTENT_LOSS=1 set — deploying anyway. Make sure these are exported.\n');
  process.exit(0);
}
console.error(
  '\nDeploying would 404 these pages and the content exists nowhere else.\n' +
    'Keep them in content.json (or list intentional spam in spam-slugs.json),\n' +
    'or re-run with ALLOW_CONTENT_LOSS=1 if the loss is intentional.\n',
);
process.exit(1);
