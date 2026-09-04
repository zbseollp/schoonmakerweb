#!/usr/bin/env node
/**
 * Soft-validate content.json posts (missing title fails; odd dates warn).
 */
import { readFileSync, existsSync } from 'node:fs';

const CONTENT = 'src/data/content.json';
const SPAM = 'src/data/spam-slugs.json';
const FUTURE_SLACK_MS = 48 * 60 * 60 * 1000;

if (!existsSync(CONTENT)) {
  console.error(`[validate-blog] missing ${CONTENT}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
const spam = new Set();
if (existsSync(SPAM)) {
  const raw = JSON.parse(readFileSync(SPAM, 'utf8'));
  for (const s of Array.isArray(raw) ? raw : raw.slugs || []) spam.add(String(s));
}

const posts = (data.posts || []).filter((p) => p?.slug && !spam.has(p.slug));
const errors = [];
const warnings = [];
const now = Date.now();

for (const p of posts) {
  if (!String(p.title || '').trim()) errors.push(`${p.slug}: missing title`);
  if (!p.date) {
    warnings.push(`${p.slug}: missing date (kept live)`);
    continue;
  }
  const t = Date.parse(p.date);
  if (Number.isNaN(t)) warnings.push(`${p.slug}: unparseable date ${JSON.stringify(p.date)} (kept live)`);
  else if (t > now + FUTURE_SLACK_MS) warnings.push(`${p.slug}: date far in future ${p.date}`);
}

for (const w of warnings.slice(0, 20)) console.warn(`[validate-blog] warn: ${w}`);
if (warnings.length > 20) console.warn(`[validate-blog] … +${warnings.length - 20} more warnings`);

if (errors.length) {
  console.error(`\n[validate-blog] ${errors.length} error(s):`);
  for (const e of errors.slice(0, 30)) console.error(`  · ${e}`);
  process.exit(1);
}

console.log(`[validate-blog] OK — ${posts.length} live post(s), ${warnings.length} warning(s)`);
