#!/usr/bin/env node
/**
 * Fail the build if live posts still contain malware / casino-affiliate junk.
 * Run after remove-spam-blog.mjs.
 */
import { readFileSync, existsSync } from 'node:fs';

const CONTENT = 'src/data/content.json';
const SPAM = 'src/data/spam-slugs.json';

const BAD =
  /playsense\.nl|apparata\.net|gameshub\.com|1337games\.org|casino-vice\.com|hashlucky|casinovergelijker\.net|bestebuitenlandsecasino|casinozonder|casinojager\.com|nieuwcasinonederland|bestecryptogok|cryptogokkensites|bestegoksites|goksites|zonder[\s-]?cruks|cruks\s+omzeilen|<script\b/i;

if (!existsSync(CONTENT)) {
  console.error('[assert-clean] missing content.json');
  process.exit(1);
}

const spam = new Set();
if (existsSync(SPAM)) {
  const raw = JSON.parse(readFileSync(SPAM, 'utf8'));
  for (const s of Array.isArray(raw) ? raw : raw.slugs || []) spam.add(String(s));
}

const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
const dirty = [];
for (const p of data.posts || []) {
  if (!p?.slug || spam.has(p.slug)) continue;
  const hay = `${p.content || ''}\n${p.seoDescription || ''}\n${p.excerpt || ''}`;
  if (BAD.test(hay)) dirty.push(p.slug);
}

if (dirty.length) {
  console.error(`\n[assert-clean] BUILD ABORTED — ${dirty.length} live post(s) still contain malware patterns:\n`);
  for (const s of dirty.slice(0, 30)) console.error(`  · ${s}`);
  console.error('\nExtend remove-spam-blog.mjs patterns, then re-run prepare:blog.\n');
  process.exit(1);
}

console.log('[assert-clean] OK — no malware hosts/scripts in live posts');
