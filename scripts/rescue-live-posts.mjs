#!/usr/bin/env node
/**
 * Pull posts that exist only on the live site back into src/content/blog.
 *
 *   node scripts/rescue-live-posts.mjs                  rescue everything guard-deploy reports missing
 *   node scripts/rescue-live-posts.mjs <url> [<url>…]   rescue specific URLs
 *   node scripts/rescue-live-posts.mjs --dry-run        show what would be written
 *
 * These tenants publish through Payload straight to the live site and the
 * markdown never lands back in git, so the live HTML is the ONLY copy. A
 * deploy from the repo would 404 those URLs permanently. This reads the live
 * page, lifts the article body out of it, and writes a normal post file so the
 * next build carries the post instead of dropping it.
 *
 * Existing files are never overwritten — a rescued post can only add.
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const BLOG_DIR = 'src/content/blog';
const dryRun = process.argv.includes('--dry-run');
const urlArgs = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a));

/**
 * Post-body containers, most specific first. Tenants name this element every
 * way BEM allows — blog-post__content, blog-article__content, entry-content —
 * so the class is matched as a pattern rather than a fixed list.
 */
const BODY_SELECTORS = [
  // Elementor's theme-post-content widget wraps the article body on sites
  // built with its Theme Builder. Must come first: those pages also contain
  // elementor-post__text blocks, which are related-post CARDS, not the body.
  /elementor-widget-theme-post-content/,
  // Any BEM element named __content on a post/article/entry/detail block.
  /[a-z-]*(?:post|article|entry|detail)__content(?:--[a-z-]+)?/,
  // A BEM __content element on any block that sits under an article wrapper,
  // e.g. vrouwenfaqs renders article-fallback__content. Kept after the
  // narrower patterns above so those still win when both are present.
  /[a-z][a-z-]*__content(?:--[a-z-]+)?/,
  /(?:post|article|entry|page)-content/,
  // Migration wrappers that aren't BEM and don't contain 'post'/'article':
  // bitcoinnieuws renders <div class="migrated-content"> inside <div class="blog-body">.
  /migrated-content/,
  /blog-body/,
  /prose-content/,
  /content-body/,
  /prose/,
];

/** Blocks that sit inside the article but are not the article. */
const TRAILING_BLOCKS = [/<aside\b[\s\S]*?<\/aside>/gi, /<nav\b[\s\S]*?<\/nav>/gi];

function siteOrigin() {
  for (const f of ['astro.config.mjs', 'astro.config.ts']) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, 'utf8').match(/site:\s*['"](https?:\/\/[^'"]+)['"]/);
    if (m) return m[1].replace(/\/+$/, '');
  }
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'astrofix-rescue' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}

/**
 * The URLs to rescue come from guard-deploy --json, not from a second crawl of
 * our own: it already knows this tenant's listing paths, its pagination shape
 * and which routes dist/ built, so anything it calls "missing" is exactly the
 * set that a deploy would 404. Re-deriving that here produced category and
 * product pages that were never posts.
 */
function missingLiveUrls(origin) {
  const guard = 'scripts/guard-deploy.mjs';
  if (!existsSync(guard)) {
    throw new Error('scripts/guard-deploy.mjs missing — copy it in, or pass URLs explicitly');
  }
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [guard, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, ALLOW_CONTENT_LOSS: '1' },
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    stdout = error.stdout ?? '';
  }
  const json = stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1);
  if (!json) throw new Error('guard-deploy produced no JSON report');
  const report = JSON.parse(json);
  return (report.missing ?? []).map((path) => `${report.origin ?? origin}${path}`);
}

function metaContent(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`,
    'i',
  );
  return (html.match(re)?.[1] ?? html.match(alt)?.[1] ?? '').trim();
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Slice out the element whose class contains `token`, balancing nested tags of
 * the same name so a wrapper div does not truncate at the first inner </div>.
 */
function extractByClass(html, token) {
  const pattern = token instanceof RegExp ? token.source : `\\b${token}\\b`;
  // Minifiers drop the quotes around single-word attribute values, so
  // `class=prose-content` is as common as `class="prose-content"`. Matching
  // only the quoted form found nothing on exactly those sites.
  const open = new RegExp(
    `<(div|article|section)\\b[^>]*class=(?:["'][^"']*${pattern}[^"']*["']|${pattern}[a-z0-9_-]*)[^>]*>`,
    'i',
  );
  const m = html.match(open);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const start = m.index + m[0].length;
  const scanner = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi');
  scanner.lastIndex = start;
  let depth = 1;
  let hit;
  while ((hit = scanner.exec(html))) {
    depth += hit[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, hit.index).trim();
  }
  return null;
}

function extractBody(html) {
  for (const token of BODY_SELECTORS) {
    let body = extractByClass(html, token);
    if (!body) continue;
    // Related-posts asides and in-article navs are chrome, not content.
    for (const block of TRAILING_BLOCKS) body = body.replace(block, '');
    if (body.replace(/<[^>]+>/g, '').trim().length > 200) return body.trim();
  }
  return null;
}

function extractDate(html) {
  // Quoted and unquoted forms — minifiers emit datetime=2026-08-20T00:00:00Z.
  // Missing this silently stamped every rescued post with today's date, which
  // sorts them all to the top of the listing ahead of genuinely newer posts.
  const iso =
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ??
    html.match(/<time[^>]+datetime=([^\s"'>]+)/i)?.[1];
  if (iso && !Number.isNaN(Date.parse(iso))) return new Date(iso).toISOString();
  const published = metaContent(html, 'article:published_time');
  if (published && !Number.isNaN(Date.parse(published))) return new Date(published).toISOString();
  return null;
}

/** True when no date could be read — the caller should say so, not invent one. */
function warnUndated(slug, failed) {
  failed.push(`${slug}: no publish date on the page — stamped with today's date, fix by hand`);
}

function yaml(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function slugOf(url) {
  return new URL(url).pathname.split('/').filter(Boolean).pop();
}

const origin = siteOrigin();
if (!origin && !urlArgs.length) {
  console.error('[rescue] no site: in astro.config — pass URLs explicitly');
  process.exit(1);
}

const extension = (() => {
  try {
    return JSON.parse(readFileSync('astropayload.config.json', 'utf8')).blogFileExtension || 'md';
  } catch {
    return 'md';
  }
})();

let targets = urlArgs;
if (!targets.length) targets = missingLiveUrls(origin);

if (!targets.length) {
  console.log('[rescue] nothing to rescue — every live post is already in the repo');
  process.exit(0);
}

mkdirSync(BLOG_DIR, { recursive: true });
let written = 0;
const failed = [];

for (const url of targets) {
  const slug = slugOf(url);
  // A rescued body is raw HTML lifted off the live page. MDX parses that as
  // JSX and dies on the first unclosed <img> or bare entity, so HTML bodies go
  // into .md — the glob loader takes both — and only real markdown keeps the
  // tenant's configured extension.
  const target = join(BLOG_DIR, `${slug}.${extension}`);
  if (existsSync(target)) {
    console.log(`  skip  ${slug} (already in repo)`);
    continue;
  }

  let html;
  try {
    html = await fetchText(url);
  } catch (error) {
    failed.push(`${slug}: fetch failed (${error.message})`);
    continue;
  }

  const body = extractBody(html);
  if (!body) {
    failed.push(`${slug}: no article body found — rescue by hand`);
    continue;
  }

  const rawTitle =
    metaContent(html, 'og:title') || html.match(/<title>([^<]*)<\/title>/i)?.[1] || slug;
  // Strip only the site-name suffix the page itself declares — a blind
  // "everything after the last dash" rule eats real titles.
  // og:site_name when the page declares one; otherwise the bare hostname,
  // which is what these tenants put in <title> ("… - Kantoortop10").
  const siteName =
    decodeEntities(metaContent(html, 'og:site_name')).trim() ||
    new URL(url).hostname.replace(/^www\./, '').replace(/\.[a-z.]+$/i, '');
  let title = decodeEntities(rawTitle).replace(/\s*\|\s*[^|]*$/, '').trim();
  if (siteName) {
    const escaped = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Also matches the domain form of the same name ("… - Kantoortop10.nl").
    title = title
      .replace(new RegExp(`\\s*[-–—|]\\s*${escaped}(?:\\.[a-z]{2,})?\\s*$`, 'i'), '')
      .trim();
  }
  // Some pages carry no meta description, and some carry the title again.
  // Neither is a usable excerpt — fall back to the body's opening prose.
  const bodyText = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const declared = decodeEntities(metaContent(html, 'og:description') || metaContent(html, 'description')).trim();
  const description =
    declared && declared.toLowerCase() !== title.toLowerCase()
      ? declared
      : bodyText.slice(0, 200).replace(/\s+\S*$/, '');
  // Some tenants build og:image as `${origin}${ogImage}` without checking
  // whether ogImage is already absolute, so the live tag can read
  // https://site.nlhttps://pub-….r2.dev/… — sometimes with the origin repeated.
  // Copying that verbatim bakes a broken URL into the rescued post.
  const image = metaContent(html, 'og:image').replace(/^(?:https?:\/\/[^/]+)+(?=https?:\/\/)/i, '');
  const foundDate = extractDate(html);
  if (!foundDate) warnUndated(slug, failed);
  const date = foundDate ?? new Date().toISOString();

  const frontmatter = [
    '---',
    `title: ${yaml(title)}`,
    description ? `description: ${yaml(description)}` : null,
    // QUOTED: unquoted ISO timestamps are parsed by YAML into Date objects,
    // which a schema typing pubDate as z.string() rejects outright (cryptoclan).
    // A quoted string satisfies both that and z.coerce.date().
    `pubDate: ${yaml(date)}`,
    `date: ${yaml(date)}`,
    'author: "Redactie"',
    'categories:',
    '  - "Blog"',
    'draft: false',
    '_status: published',
    image ? `featuredImage: ${yaml(image)}` : null,
    image ? `heroImage: ${yaml(image)}` : null,
    '---',
  ]
    // filter(Boolean) would also drop a trailing '' terminator, gluing the
    // body onto the closing --- line.
    .filter(Boolean)
    .join('\n');

  const looksLikeHtml = /<(?:p|div|h[1-6]|ul|ol|table|section|article)\b/i.test(body);
  const outPath = looksLikeHtml ? join(BLOG_DIR, `${slug}.md`) : target;
  if (existsSync(outPath)) {
    console.log(`  skip  ${slug} (already in repo)`);
    continue;
  }

  console.log(`  ${dryRun ? 'would write' : 'write'} ${outPath}  (${body.length} bytes of body)`);
  if (!dryRun) writeFileSync(outPath, `${frontmatter}\n${body}\n`);
  written += 1;
}

console.log(`\n[rescue] ${written} post(s) ${dryRun ? 'would be ' : ''}recovered from the live site`);
if (failed.length) {
  console.log('[rescue] could not rescue:');
  failed.forEach((f) => console.log(`  · ${f}`));
  process.exit(1);
}
