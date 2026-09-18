#!/usr/bin/env node
/**
 * Keep .blog-count-floor / .blog-published-floor present so prepare:blog never
 * aborts after an accidental delete. Floors only ratchet upward.
 *
 *   node scripts/ensure-floors.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_COUNT_FLOOR,
  DEFAULT_PUBLISHED_FLOOR,
  FUTURE_SLACK_MS,
} from './lib/publish-guards.mjs';

const CONTENT = 'src/data/content.json';
const SPAM = 'src/data/spam-slugs.json';
const COUNT_FLOOR = '.blog-count-floor';
const PUB_FLOOR = '.blog-published-floor';

function readFloor(path) {
  if (!existsSync(path)) return null;
  const n = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function restoreFromGit(path) {
  try {
    const body = execFileSync('git', ['show', `HEAD:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const n = Number.parseInt(body, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeFloor(path, n) {
  writeFileSync(path, `${n}\n`, 'utf8');
}

function liveCount() {
  if (!existsSync(CONTENT)) return { total: 0, live: 0 };
  const data = JSON.parse(readFileSync(CONTENT, 'utf8'));
  const posts = Array.isArray(data.posts) ? data.posts : [];
  let spam = new Set();
  if (existsSync(SPAM)) {
    const raw = JSON.parse(readFileSync(SPAM, 'utf8'));
    spam = new Set((Array.isArray(raw) ? raw : raw.slugs || []).map(String));
  }
  const now = Date.now();
  const live = posts.filter((p) => {
    if (!p?.slug || spam.has(p.slug)) return false;
    if (!p.date) return true;
    const t = Date.parse(p.date);
    if (Number.isNaN(t)) return true;
    return t <= now + FUTURE_SLACK_MS;
  });
  return { total: posts.length, live: live.length };
}

const { total, live } = liveCount();

let countFloor = readFloor(COUNT_FLOOR);
if (countFloor === null) {
  countFloor = restoreFromGit(COUNT_FLOOR) ?? DEFAULT_COUNT_FLOOR;
  writeFloor(COUNT_FLOOR, countFloor);
  console.log(`[ensure-floors] restored ${COUNT_FLOOR} → ${countFloor}`);
}

let pubFloor = readFloor(PUB_FLOOR);
if (pubFloor === null) {
  pubFloor = restoreFromGit(PUB_FLOOR) ?? DEFAULT_PUBLISHED_FLOOR;
  writeFloor(PUB_FLOOR, pubFloor);
  console.log(`[ensure-floors] restored ${PUB_FLOOR} → ${pubFloor}`);
}

// Ratchet floors up with healthy catalogs so growth is protected next deploy.
if (total > countFloor) {
  writeFloor(COUNT_FLOOR, total);
  console.log(`[ensure-floors] raised ${COUNT_FLOOR} ${countFloor} → ${total}`);
  countFloor = total;
}
if (live > pubFloor) {
  writeFloor(PUB_FLOOR, live);
  console.log(`[ensure-floors] raised ${PUB_FLOOR} ${pubFloor} → ${live}`);
  pubFloor = live;
}

console.log(
  `[ensure-floors] OK — count floor ${countFloor} (posts ${total}), ` +
    `published floor ${pubFloor} (live ${live})`,
);
