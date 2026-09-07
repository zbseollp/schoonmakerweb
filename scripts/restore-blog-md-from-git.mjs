#!/usr/bin/env node
/**
 * After Jenkins `tenant-cli sync --clean`, Payload may wipe src/content/blog
 * down to a handful of CMS posts. Restore every git-tracked blog markdown file
 * that is missing so:
 *   1) merge-payload-blog still sees full catalog helpers from git
 *   2) future Payload "Import blog" is never empty again
 *
 * Existing on-disk files win (Payload sync output is kept).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_REL = 'src/content/blog';
const BLOG_DIR = path.join(ROOT, BLOG_REL);
const CANARY_PATH = path.join(ROOT, 'scripts/blog-canaries.txt');

function listGitBlogFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', BLOG_REL], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out
      .split('\0')
      .filter(Boolean)
      .filter((f) => /\.(md|mdx)$/i.test(f));
  } catch (err) {
    console.warn('[restore-blog-md] git ls-files failed:', err?.message || err);
    return [];
  }
}

function readCanaries() {
  if (!fs.existsSync(CANARY_PATH)) return [];
  return fs
    .readFileSync(CANARY_PATH, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

fs.mkdirSync(BLOG_DIR, { recursive: true });
const tracked = listGitBlogFiles();
let restored = 0;
let skipped = 0;

for (const rel of tracked) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) {
    skipped += 1;
    continue;
  }
  try {
    const body = execFileSync('git', ['show', `HEAD:${rel}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
    restored += 1;
    console.log(`[restore-blog-md] restored ${rel}`);
  } catch (err) {
    console.warn(`[restore-blog-md] failed ${rel}:`, err?.message || err);
  }
}

for (const id of readCanaries()) {
  const relMd = path.join(BLOG_REL, `${id}.md`);
  const abs = path.join(ROOT, relMd);
  if (fs.existsSync(abs)) continue;
  try {
    const body = execFileSync('git', ['show', `HEAD:${relMd}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    fs.writeFileSync(abs, body, 'utf8');
    restored += 1;
    console.log(`[restore-blog-md] restored canary ${relMd}`);
  } catch {
    // Canary may live only in content.json — assert-publish-ready checks live JSON.
    console.warn(
      `[restore-blog-md] canary md missing from git (ok if in content.json): ${id}.md`,
    );
  }
}

const onDisk = fs.readdirSync(BLOG_DIR).filter((f) => /\.(md|mdx)$/i.test(f)).length;
console.log(
  `[restore-blog-md] done: restored=${restored} kept-existing=${skipped} ` +
    `on-disk=${onDisk} git-tracked=${tracked.length}`,
);
