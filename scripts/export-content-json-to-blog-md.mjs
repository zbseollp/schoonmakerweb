#!/usr/bin/env node
/**
 * Export src/data/content.json posts → src/content/blog/*.md so Payload
 * "Import blog" / Jenkins import can refill the CMS.
 *
 * This site's source of truth for the live site is content.json. Payload only
 * reads markdown under src/content/blog — which was empty, so Admin looked bare
 * even while schoonmakerweb.nl still had articles.
 *
 *   node scripts/export-content-json-to-blog-md.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT = 'src/data/content.json';
const BLOG = 'src/content/blog';

function yamlQuote(value) {
  if (value == null) return '""';
  return JSON.stringify(String(value));
}

function toIsoDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString();
}

function htmlToMarkdownBody(html) {
  const raw = String(html || '').trim();
  if (!raw) return '';
  // Keep HTML — Payload import converts via markdown→Lexical and accepts HTML blocks.
  return raw;
}

if (!existsSync(CONTENT)) {
  console.error(`[export-blog-md] missing ${CONTENT}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
const posts = Array.isArray(data.posts) ? data.posts : [];
if (posts.length === 0) {
  console.error('[export-blog-md] content.json has zero posts');
  process.exit(1);
}

mkdirSync(BLOG, { recursive: true });

// Remove prior exports (keep .gitkeep)
for (const name of readdirSync(BLOG)) {
  if (name === '.gitkeep') continue;
  if (/\.mdx?$/i.test(name)) unlinkSync(join(BLOG, name));
}

let written = 0;
for (const post of posts) {
  const slug = String(post.slug || '').trim();
  if (!slug) continue;

  const title = post.title || slug;
  const description = post.seoDescription || post.excerpt || title;
  const pubDate = toIsoDate(post.date);
  const updatedDate = toIsoDate(post.modified || post.date);
  const featured = post.featuredImage || post.ogImage || '';
  const cats = Array.isArray(post.categories)
    ? post.categories.map((c) => (typeof c === 'string' ? c : c?.name || c?.slug)).filter(Boolean)
    : ['Blog'];

  const lines = [
    '---',
    `title: ${yamlQuote(title)}`,
    `slug: ${yamlQuote(slug)}`,
    `description: ${yamlQuote(description)}`,
    `excerpt: ${yamlQuote(post.excerpt || description)}`,
    `pubDate: ${yamlQuote(pubDate)}`,
    `date: ${yamlQuote(pubDate)}`,
  ];
  if (updatedDate) lines.push(`updatedDate: ${yamlQuote(updatedDate)}`);
  if (featured) {
    lines.push(`featuredImage: ${yamlQuote(featured)}`);
    lines.push(`heroImage: ${yamlQuote(featured)}`);
    lines.push(`image: ${yamlQuote(featured)}`);
  }
  lines.push('draft: false');
  lines.push('publishStatus: "published"');
  lines.push('categories:');
  for (const c of cats) lines.push(`  - ${yamlQuote(c)}`);
  lines.push('---');
  lines.push('');
  lines.push(htmlToMarkdownBody(post.content));
  lines.push('');

  writeFileSync(join(BLOG, `${slug}.md`), lines.join('\n'), 'utf8');
  written += 1;
}

console.log(
  `[export-blog-md] wrote ${written} markdown file(s) to ${BLOG}/ ` +
    `(from ${posts.length} content.json post(s))`,
);
console.log(
  '[export-blog-md] Next: commit+push these files, then in Payload Admin ' +
    '(tenant schoonmakerweb) run Import blog / force re-import.',
);
