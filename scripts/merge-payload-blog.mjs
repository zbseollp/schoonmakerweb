#!/usr/bin/env node
/**
 * Merge Payload-synced markdown from src/content/blog into content.json.
 *
 * Jenkins runs `tenant-cli sync --blog-path src/content/blog`. This site's
 * routes read src/data/content.json — without this merge, Payload publishes
 * never appear online.
 *
 *   node scripts/merge-payload-blog.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT = 'src/data/content.json';
const BLOG = 'src/content/blog';
const FUTURE_SLACK_MS = 48 * 60 * 60 * 1000;

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw.trim() };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    data[kv[1]] = v;
  }
  return { data, body: m[2].trim() };
}

function mdToHtml(md) {
  if (!md) return '';
  // Payload usually exports HTML-ish or simple markdown paragraphs.
  if (/<[a-z][\s\S]*>/i.test(md)) return md;
  return md
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trim();
      if (!t) return '';
      if (/^#{1,3}\s+/.test(t)) {
        const level = t.match(/^#+/)[0].length;
        const text = t.replace(/^#{1,3}\s+/, '');
        return `<h${level}>${text}</h${level}>`;
      }
      return `<p>${t.replace(/\n/g, '<br/>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

function isDraft(data) {
  const d = String(data.draft ?? '').toLowerCase();
  if (d === 'true' || d === '1' || d === 'yes' || d === 'draft') return true;
  const status = String(data.publishStatus ?? data._status ?? '').toLowerCase();
  // Empty status = treat as published (Payload sync often omits the field).
  if (!status) return false;
  return status !== 'published' && status !== 'publish';
}

function toEntry(slug, data, body) {
  const date = data.pubDate || data.date || '';
  const title = data.title || slug;
  const excerpt = data.excerpt || data.description || '';
  const html = mdToHtml(body);
  const image =
    data.featuredImage || data.heroImage || data.image || data.ogImage || '';
  return {
    slug,
    path: `/${slug}/`,
    kind: 'post',
    title,
    date,
    modified: data.updatedDate || date,
    content: html,
    excerpt,
    categories: [{ slug: 'blog', name: 'Blog' }],
    tags: [],
    featuredImage: typeof image === 'string' ? image : '',
    seoTitle: title,
    seoDescription: excerpt,
    canonical: `https://schoonmakerweb.nl/${slug}/`,
    ogImage: typeof image === 'string' ? image : '',
    _source: 'payload',
  };
}

if (!existsSync(CONTENT)) {
  console.error(`[merge-payload-blog] missing ${CONTENT}`);
  process.exit(1);
}

mkdirSync(BLOG, { recursive: true });
const files = readdirSync(BLOG).filter((f) => /\.mdx?$/i.test(f));
const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
if (!Array.isArray(data.posts)) data.posts = [];

const bySlug = new Map(data.posts.map((p) => [p.slug, p]));
const now = Date.now();
let merged = 0;
let skipped = 0;

for (const file of files) {
  const slug = file.replace(/\.mdx?$/i, '');
  const raw = readFileSync(join(BLOG, file), 'utf8');
  const { data: fm, body } = parseFrontmatter(raw);
  if (isDraft(fm)) {
    skipped += 1;
    continue;
  }
  const dateRaw = fm.pubDate || fm.date;
  if (dateRaw) {
    const t = Date.parse(dateRaw);
    if (!Number.isNaN(t) && t > now + FUTURE_SLACK_MS) {
      skipped += 1;
      continue;
    }
  }
  const entry = toEntry(slug, fm, body);
  const prev = bySlug.get(slug);
  if (prev) {
    const payloadText = String(entry.content || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const payloadHasBody = payloadText.length > 40;
    bySlug.set(slug, {
      ...prev,
      ...entry,
      // Never gut a full WP article with an empty/stub CMS body.
      content: payloadHasBody ? entry.content : prev.content,
      excerpt: entry.excerpt || prev.excerpt,
      featuredImage: entry.featuredImage || prev.featuredImage,
      ogImage: entry.ogImage || prev.ogImage,
      seoTitle: entry.seoTitle || prev.seoTitle,
      seoDescription: entry.seoDescription || prev.seoDescription,
      categories: entry.categories?.length ? entry.categories : prev.categories,
      author: prev.author ?? entry.author,
      modified: entry.modified || prev.modified || entry.date || prev.date,
    });
  } else {
    bySlug.set(slug, entry);
  }
  merged += 1;
}

data.posts = [...bySlug.values()];
writeFileSync(CONTENT, JSON.stringify(data));
console.log(
  `[merge-payload-blog] merged ${merged} Payload post(s) into content.json ` +
    `(${skipped} draft/scheduled skipped; ${data.posts.length} total posts)`,
);
