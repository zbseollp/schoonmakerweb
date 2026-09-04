#!/usr/bin/env node
/**
 * Fail the build if content.json post count shrank or fell below the floor.
 *
 *   node scripts/assert-blog-count.mjs --snapshot
 *   node scripts/assert-blog-count.mjs --verify
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT = 'src/data/content.json';
const STAMP = join('node_modules', '.cache', 'blog-count.json');
const FLOOR_FILE = '.blog-count-floor';
const mode = process.argv.includes('--verify') ? 'verify' : 'snapshot';

if (!existsSync(CONTENT)) {
  console.error(`[assert-blog-count] missing ${CONTENT}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
const posts = Array.isArray(data.posts) ? data.posts : [];
const slugs = posts.map((p) => p.slug).filter(Boolean).sort();
const count = slugs.length;

function readFloor() {
  if (!existsSync(FLOOR_FILE)) return null;
  const n = Number.parseInt(readFileSync(FLOOR_FILE, 'utf8').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function assertFloor(n, when) {
  const floor = readFloor();
  if (floor === null) return;
  if (n < floor) {
    console.error(
      `\n[assert-blog-count] BUILD ABORTED — post count ${n} below floor ${floor} (${when}).\n` +
        `A sync likely wiped content. Restore content.json before deploying.\n`,
    );
    process.exit(1);
  }
}

if (mode === 'snapshot') {
  assertFloor(count, 'before prepare');
  mkdirSync(join('node_modules', '.cache'), { recursive: true });
  writeFileSync(STAMP, JSON.stringify({ count, slugs }));
  console.log(`[assert-blog-count] ${count} post(s) in content.json before prepare`);
  process.exit(0);
}

if (!existsSync(STAMP)) {
  console.log('[assert-blog-count] no snapshot — skipping drop check');
  assertFloor(count, 'after prepare');
  process.exit(0);
}

const before = JSON.parse(readFileSync(STAMP, 'utf8'));
const now = new Set(slugs);
const missing = before.slugs.filter((s) => !now.has(s));
if (missing.length > 0) {
  console.error(
    `\n[assert-blog-count] BUILD ABORTED — ${missing.length} post(s) disappeared ` +
      `(${before.count} → ${count}).`,
  );
  for (const s of missing.slice(0, 20)) console.error(`  · ${s}`);
  console.error('Hide spam via spam-slugs.json — never delete posts from content.json.\n');
  process.exit(1);
}

assertFloor(count, 'after prepare');
console.log(`[assert-blog-count] ${count} post(s) after prepare — none lost`);
