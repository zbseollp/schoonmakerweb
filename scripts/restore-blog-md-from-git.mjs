#!/usr/bin/env node
/**
 * After Jenkins `tenant-cli sync --clean`, Payload may wipe src/content/blog
 * down to current CMS posts. Restore every git-tracked blog markdown file
 * that is missing so:
 *   1) merge-payload-blog still sees full catalog helpers from git
 *   2) future Payload "Import blog" is never empty again
 *
 * Existing on-disk files win (Payload sync output is kept).
 * Slugs listed in src/data/dropped-slugs.json are never restored — editorial
 * takedowns / Payload deletes stay offline after sync --clean.
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
const DROPPED_PATH = path.join(ROOT, 'src/data/dropped-slugs.json');

/** Editorial takedowns — do not resurrect their .md after Payload sync --clean. */
function editorialDropSlugs() {
  if (!fs.existsSync(DROPPED_PATH)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(DROPPED_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.slugs || [];
    return new Set(
      list.map((e) => String(typeof e === 'string' ? e : e.slug).trim()).filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function slugFromBlogRel(rel) {
  return path.basename(rel).replace(/\.(md|mdx)$/i, '');
}

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
const dropped = editorialDropSlugs();
let restored = 0;
let skipped = 0;
let skippedDropped = 0;

for (const rel of tracked) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) {
    skipped += 1;
    continue;
  }
  if (dropped.has(slugFromBlogRel(rel))) {
    skippedDropped += 1;
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
  if (dropped.has(id)) continue;
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
    `skipped-dropped=${skippedDropped} on-disk=${onDisk} git-tracked=${tracked.length}`,
);
