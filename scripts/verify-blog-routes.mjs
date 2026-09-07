#!/usr/bin/env node
/**
 * Post-build: canary article pages must exist in dist/ or deploy is blocked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CANARY_PATH = path.join(ROOT, 'scripts/blog-canaries.txt');

function readCanaries() {
  if (!fs.existsSync(CANARY_PATH)) return [];
  return fs
    .readFileSync(CANARY_PATH, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

if (!fs.existsSync(DIST)) {
  console.error('[verify-blog-routes] dist/ missing — run astro build first');
  process.exit(1);
}

const canaries = readCanaries();
if (canaries.length < 5) {
  console.error(
    `[verify-blog-routes] need >= 5 canaries in scripts/blog-canaries.txt (got ${canaries.length})`,
  );
  process.exit(1);
}

function hasDistPage(id) {
  return (
    fs.existsSync(path.join(DIST, id, 'index.html')) ||
    fs.existsSync(path.join(DIST, `${id}.html`))
  );
}

const missing = canaries.filter((id) => !hasDistPage(id));
if (missing.length) {
  console.error('[verify-blog-routes] canary pages missing from dist/ (would 404 on deploy):');
  for (const id of missing) console.error(`  /${id}/`);
  process.exit(1);
}

console.log(`[verify-blog-routes] OK (${canaries.length} canaries present in dist)`);
