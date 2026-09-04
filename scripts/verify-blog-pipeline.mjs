#!/usr/bin/env node
/**
 * Early pipeline check (before astro build) so article-loss fails fast.
 * Wired into prepare:blog after spam clean + validate.
 */
import { readFileSync, existsSync } from 'node:fs';

const CONTENT = 'src/data/content.json';
const SPAM = 'src/data/spam-slugs.json';
const PKG = 'package.json';
const PUBLISHED_FLOOR = '.blog-published-floor';
const COUNT_FLOOR = '.blog-count-floor';
const FUTURE_SLACK_MS = 48 * 60 * 60 * 1000;

function fail(msg) {
  console.error(`\n[verify-blog-pipeline] BUILD ABORTED — ${msg}\n`);
  process.exit(1);
}

function readFloor(path) {
  if (!existsSync(path)) return null;
  const n = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

if (!existsSync(CONTENT)) fail(`missing ${CONTENT}`);
if (!existsSync(SPAM)) fail(`missing ${SPAM} — run remove-spam-blog.mjs first`);
if (!existsSync(COUNT_FLOOR) || !existsSync(PUBLISHED_FLOOR)) {
  fail('missing .blog-count-floor or .blog-published-floor');
}

const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
const posts = Array.isArray(data.posts) ? data.posts : [];
if (posts.length === 0) fail('content.json has zero posts');

const countFloor = readFloor(COUNT_FLOOR);
if (countFloor !== null && posts.length < countFloor) {
  fail(`post count ${posts.length} below floor ${countFloor}`);
}

const spamRaw = JSON.parse(readFileSync(SPAM, 'utf8'));
const spam = new Set((Array.isArray(spamRaw) ? spamRaw : spamRaw.slugs || []).map(String));
const now = Date.now();
const live = posts.filter((p) => {
  if (!p?.slug || spam.has(p.slug)) return false;
  if (!p.date) return true;
  const t = Date.parse(p.date);
  if (Number.isNaN(t)) return true;
  return t <= now + FUTURE_SLACK_MS;
});

const pubFloor = readFloor(PUBLISHED_FLOOR);
if (live.length === 0) fail('zero live posts after spam filter');
if (pubFloor !== null && live.length < pubFloor) {
  fail(`only ${live.length} live post(s), below published floor ${pubFloor}`);
}

// Jenkins runs `npm run build` — refuse a package.json that drops the gates
if (!existsSync(PKG)) fail('missing package.json');
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const build = String(pkg.scripts?.build || '');
for (const needed of [
  'prepare:blog',
  'assert-publish-ready.mjs',
  'assert-publish-ready.mjs --dist',
  'guard-deploy.mjs',
]) {
  if (!build.includes(needed)) {
    fail(`package.json build script must include "${needed}" (Jenkins never runs npm run deploy)`);
  }
}

const prepare = String(pkg.scripts?.['prepare:blog'] || '');
for (const needed of [
  'assert-blog-count.mjs',
  'merge-payload-blog.mjs',
  'remove-spam-blog.mjs',
  'assert-content-clean.mjs',
  'assert-publish-ready.mjs',
]) {
  if (!prepare.includes(needed)) {
    fail(`package.json prepare:blog must include "${needed}"`);
  }
}

console.log(
  `[verify-blog-pipeline] OK — ${posts.length} posts, ${live.length} live ` +
    `(floors ${countFloor}/${pubFloor}), build gates present`,
);
