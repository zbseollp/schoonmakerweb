#!/usr/bin/env node
/**
 * Hard gates so "articles do not come online" cannot silently return.
 *
 *   node scripts/assert-publish-ready.mjs
 *   node scripts/assert-publish-ready.mjs --dist
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const EXPECTED_REPO = 'zbseollp/schoonmakerweb';
const CONTENT = 'src/data/content.json';
const SPAM_FILE = 'src/data/spam-slugs.json';
const CONTENT_TS = 'src/lib/content.ts';
const FLOOR_FILE = '.blog-count-floor';
const PUBLISHED_FLOOR_FILE = '.blog-published-floor';
const CANARY_FILE = 'scripts/blog-canaries.txt';
const FUTURE_SLACK_MS = 48 * 60 * 60 * 1000;
const distMode = process.argv.includes('--dist');

function readCanaries() {
  if (!existsSync(CANARY_FILE)) return [];
  return readFileSync(CANARY_FILE, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

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

/**
 * Payload Import / restore-from-git only work when markdown is in git.
 * Empty blog/ in the remote is how Admin looked empty while live still had posts.
 */
function assertBlogMarkdownInGit() {
  const onDisk = existsSync('src/content/blog')
    ? readdirSync('src/content/blog').filter((f) => /\.(md|mdx)$/i.test(f)).length
    : 0;

  let tracked = 0;
  try {
    const out = execFileSync('git', ['ls-files', '-z', 'src/content/blog'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    tracked = out
      .split('\0')
      .filter(Boolean)
      .filter((f) => /\.(md|mdx)$/i.test(f)).length;
  } catch {
    tracked = 0;
  }

  const inCi = Boolean(process.env.JENKINS_URL || process.env.CI || process.env.GITHUB_ACTIONS);
  const minMd = 50;

  if (inCi && tracked < minMd) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — only ${tracked} git-tracked blog .md file(s) ` +
        `(need >= ${minMd}).\n` +
        `Run npm run export:blog-md, commit+push src/content/blog/*.md, then Import blog in Payload.\n` +
        `Without this, Payload Admin stays empty while content.json still powers the live site.\n`,
    );
    process.exit(1);
  }

  if (!inCi && tracked < minMd && onDisk < minMd) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — blog markdown catalog missing ` +
        `(git=${tracked}, disk=${onDisk}, need >= ${minMd}).\n` +
        `Run: npm run export:blog-md\n`,
    );
    process.exit(1);
  }

  if (!inCi && tracked < minMd) {
    console.warn(
      `[assert-publish-ready] WARN — ${tracked} blog .md tracked in git (disk ${onDisk}). ` +
        `Commit+push the export before Jenkins / Payload Import or CMS will look empty.`,
    );
  } else {
    console.log(
      `[assert-publish-ready] blog markdown catalog: git=${tracked}, disk=${onDisk}`,
    );
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

  if (!existsSync(CANARY_FILE)) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — missing ${CANARY_FILE}.\n` +
        `Canaries are required so key articles cannot silently 404.\n`,
    );
    process.exit(1);
  }

  const liveSlugs = new Set(live.map((p) => p.slug));
  const canaries = readCanaries();
  if (canaries.length < 5) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — ${CANARY_FILE} needs >= 5 slugs (got ${canaries.length}).\n`,
    );
    process.exit(1);
  }
  const missing = canaries.filter((slug) => !liveSlugs.has(slug));
  if (missing.length) {
    console.error(
      `\n[assert-publish-ready] BUILD ABORTED — canary post(s) not live:\n` +
        missing.map((s) => `  · /${s}/`).join('\n') +
        `\n`,
    );
    process.exit(1);
  }

  console.log(
    `[assert-publish-ready] ${live.length} live post(s)` +
      (floor ? ` (floor ${floor})` : '') +
      `, ${canaries.length} canaries OK`,
  );
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
assertBlogMarkdownInGit();
assertFloorPresent();
assertContentPipeline();
assertPublishedFloor();

if (distMode) assertDistHasPublishedPosts();
else console.log(`[assert-publish-ready] OK — repo ${EXPECTED_REPO}, no wrangler routes, floors present`);
