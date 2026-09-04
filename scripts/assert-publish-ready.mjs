#!/usr/bin/env node
/**
 * Hard gates so "articles do not come online" cannot silently return.
 *
 *   node scripts/assert-publish-ready.mjs
 *   node scripts/assert-publish-ready.mjs --dist
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const EXPECTED_REPO = 'zbseollp/schoonmakerweb';
const CONTENT = 'src/data/content.json';
const SPAM_FILE = 'src/data/spam-slugs.json';
const CONTENT_TS = 'src/lib/content.ts';
const FLOOR_FILE = '.blog-count-floor';
const PUBLISHED_FLOOR_FILE = '.blog-published-floor';
const FUTURE_SLACK_MS = 48 * 60 * 60 * 1000;
const distMode = process.argv.includes('--dist');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readFloor(path) {
  if (!existsSync(path)) return null;
  const n = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function assertNoWranglerRoutes() {
  for (const file of ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'].filter((f) => existsSync(f))) {
    const raw = readFileSync(file, 'utf8');
    if (/"routes"\s*:/.test(raw) || /^\s*routes\s*=/m.test(raw)) {
      console.error(
        `\n[assert-publish-ready] BUILD ABORTED — ${file} contains custom-domain routes.\n` +
          `Domains stay in the Cloudflare dashboard only; routes in wrangler break Jenkins.\n`,
      );
      process.exit(1);
    }
    // SPA fallback hides missing articles as soft 200s — refuse it
    if (/not_found_handling\s*=\s*["']single-page-application["']/i.test(raw)) {
      console.error(
        `\n[assert-publish-ready] BUILD ABORTED — ${file} uses SPA not_found_handling.\n` +
          `Use not_found_handling = "404-page" so missing articles stay real 404s.\n`,
      );
      process.exit(1);
    }
  }
}

function assertGithubRepo() {
  if (!existsSync('astropayload.config.json')) {
    console.error('[assert-publish-ready] missing astropayload.config.json');
    process.exit(1);
  }
  const repo = String(readJson('astropayload.config.json').githubRepo || '').trim();
  if (repo !== EXPECTED_REPO) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — githubRepo is ${JSON.stringify(repo) || '(missing)'}, ` +
        `expected ${JSON.stringify(EXPECTED_REPO)}.\n` +
        `Also set the same value on the Tenant in Payload Admin.\n`,
    );
    process.exit(1);
  }
}

function assertFloorPresent() {
  if (!existsSync(FLOOR_FILE) || !existsSync(PUBLISHED_FLOOR_FILE)) {
    console.error('[assert-publish-ready] missing .blog-count-floor or .blog-published-floor');
    process.exit(1);
  }
}

function assertContentPipeline() {
  if (!existsSync(CONTENT)) {
    console.error(`[assert-publish-ready] missing ${CONTENT}`);
    process.exit(1);
  }
  if (!existsSync(SPAM_FILE)) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — missing ${SPAM_FILE}.\n` +
        `Run prepare:blog (remove-spam-blog.mjs) before build.\n`,
    );
    process.exit(1);
  }
  if (!existsSync(CONTENT_TS)) {
    console.error(`[assert-publish-ready] missing ${CONTENT_TS}`);
    process.exit(1);
  }
  const ts = readFileSync(CONTENT_TS, 'utf8');
  if (!/spam-slugs\.json/.test(ts) || !/isLivePost|spamSlugs/.test(ts)) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — ${CONTENT_TS} no longer filters spam-slugs.\n` +
        `Posts would ship without the malware/spam gate.\n`,
    );
    process.exit(1);
  }
  if (!/FUTURE_SLACK_MS/.test(ts)) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — ${CONTENT_TS} missing FUTURE_SLACK_MS date slack.\n` +
        `CMS dates a few hours ahead would drop articles offline.\n`,
    );
    process.exit(1);
  }
}

function spamSet() {
  if (!existsSync(SPAM_FILE)) return new Set();
  const raw = readJson(SPAM_FILE);
  const list = Array.isArray(raw) ? raw : raw.slugs || [];
  return new Set(list.map(String));
}

function livePosts() {
  const data = readJson(CONTENT);
  const spam = spamSet();
  const now = Date.now();
  return (data.posts || []).filter((p) => {
    if (!p?.slug || spam.has(p.slug)) return false;
    if (!p.date) return true;
    const t = Date.parse(p.date);
    if (Number.isNaN(t)) return true;
    return t <= now + FUTURE_SLACK_MS;
  });
}

function assertPublishedFloor() {
  const floor = readFloor(PUBLISHED_FLOOR_FILE);
  const live = livePosts();
  if (live.length === 0) {
    console.error('\n[assert-publish-ready] BUILD ABORTED — zero live posts.\n');
    process.exit(1);
  }
  if (floor !== null && live.length < floor) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — only ${live.length} live post(s), below floor ${floor}.\n` +
        `A sync/spam wipe likely took articles offline. Restore content before deploying.\n`,
    );
    process.exit(1);
  }
  console.log(`[assert-publish-ready] ${live.length} live post(s)` + (floor ? ` (floor ${floor})` : ''));
}

function assertDistHasPublishedPosts() {
  if (!existsSync('dist')) {
    console.error('[assert-publish-ready] dist/ missing — run astro build first');
    process.exit(1);
  }
  const live = livePosts();
  if (live.length === 0) {
    console.error('[assert-publish-ready] BUILD ABORTED — no live posts');
    process.exit(1);
  }
  const missing = live.filter((p) => !existsSync(join('dist', p.slug, 'index.html')));
  if (missing.length > 0) {
    console.error(`\n[assert-publish-ready] BUILD ABORTED — ${missing.length} live post(s) missing from dist/:\n`);
    for (const p of missing.slice(0, 30)) console.error(`  · /${p.slug}/`);
    process.exit(1);
  }

  // Listing pages must exist or the blog looks "empty" even when posts built
  const listings = ['blog/index.html', 'category/blog/index.html'];
  const missingListings = listings.filter((rel) => !existsSync(join('dist', rel)));
  if (missingListings.length > 0) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — blog listing page(s) missing from dist/:\n` +
        missingListings.map((r) => `  · /${r.replace(/index\.html$/, '')}`).join('\n') +
        '\n',
    );
    process.exit(1);
  }

  console.log(
    `[assert-publish-ready] dist OK — ${live.length} live post(s) + blog listings present`,
  );
}

assertNoWranglerRoutes();
assertGithubRepo();
assertFloorPresent();
assertContentPipeline();
assertPublishedFloor();

if (distMode) assertDistHasPublishedPosts();
else console.log(`[assert-publish-ready] OK — repo ${EXPECTED_REPO}, no wrangler routes, floors present`);
