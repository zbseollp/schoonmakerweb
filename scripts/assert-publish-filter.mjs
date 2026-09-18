#!/usr/bin/env node
/**
 * Fail prepare:blog if leftover `draft: true` is treated as unpublished
 * (Cryptoclan / geldkwesties regression), or if the Payload→JSON merge gate
 * is removed from the pipeline.
 *
 *   node scripts/assert-publish-filter.mjs
 */
import { readFileSync, existsSync } from 'node:fs';

const MERGE = 'scripts/merge-payload-blog.mjs';
const CONTENT_TS = 'src/lib/content.ts';
const PKG = 'package.json';

function fail(msg) {
  console.error(`\n[assert-publish-filter] BUILD ABORTED — ${msg}\n`);
  process.exit(1);
}

for (const file of [MERGE, CONTENT_TS, PKG]) {
  if (!existsSync(file)) fail(`missing ${file}`);
}

const merge = readFileSync(MERGE, 'utf8');
const contentTs = readFileSync(CONTENT_TS, 'utf8');
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const prepare = String(pkg.scripts?.['prepare:blog'] || '');
const build = String(pkg.scripts?.build || '');

// --- merge must not skip on leftover draft boolean alone ---
if (/function\s+isDraft\s*\(/.test(merge)) {
  fail(
    `${MERGE} still has isDraft(). Use shouldSkipPost + publishStatus/_status — never draft alone.`,
  );
}
if (/String\(data\.draft[\s\S]{0,200}?return\s+true/.test(merge)) {
  fail(
    `${MERGE} filters on leftover draft alone. CMS publishStatus/_status is source of truth.`,
  );
}
if (!/shouldSkipPost\s*\(/.test(merge)) {
  fail(`${MERGE} must define/use shouldSkipPost(slug, data).`);
}
if (!/publishStatus/.test(merge) || !/_status/.test(merge)) {
  fail(`${MERGE} must read publishStatus / _status.`);
}
if (!/isTestSlug\s*\(/.test(merge)) {
  fail(`${MERGE} must use isTestSlug() so test/hello-world stubs never merge.`);
}
if (!/merge-payload-blog\.mjs/.test(prepare)) {
  fail('package.json prepare:blog must run merge-payload-blog.mjs (Payload→content.json).');
}
if (!/ensure-floors\.mjs/.test(prepare)) {
  fail('package.json prepare:blog must run ensure-floors.mjs.');
}
if (!/assert-publish-filter\.mjs/.test(prepare)) {
  fail('package.json prepare:blog must run assert-publish-filter.mjs.');
}
if (!/prepare:blog/.test(build) || !/assert-publish-ready\.mjs/.test(build)) {
  fail('package.json build must keep prepare:blog + assert-publish-ready gates.');
}

// --- runtime loader must never hide on leftover draft ---
if (
  /data\.draft\s*!==\s*true/.test(contentTs) ||
  /if\s*\(\s*(?:p\.)?data\.draft\s*\)/.test(contentTs) ||
  /\.filter\([^)]*draft/.test(contentTs)
) {
  fail(
    `${CONTENT_TS} must not filter listings on leftover draft. Hide only spam / future dates / stubs.`,
  );
}
if (!/spam-slugs\.json/.test(contentTs) || !/isLivePost/.test(contentTs)) {
  fail(`${CONTENT_TS} must keep isLivePost + spam-slugs gate.`);
}
if (!/isScheduledFuture/.test(contentTs) || !/isTestSlug/.test(contentTs)) {
  fail(`${CONTENT_TS} must hide scheduled posts until pubDate and hide test slugs.`);
}
const publishTs = 'src/lib/publish.ts';
if (!existsSync(publishTs) || !/FUTURE_SLACK_MS/.test(readFileSync(publishTs, 'utf8'))) {
  fail(`${publishTs} must define FUTURE_SLACK_MS (clock skew only, not multi-day early publish).`);
}

console.log(
  '[assert-publish-filter] OK — merge uses CMS status (not leftover draft); ' +
    'loader + prepare:blog gates intact',
);
