/**
 * Shared publish guards for schoonmakerweb Jenkins + local builds.
 *
 * Failure mode we must never repeat:
 * - Live site uses src/data/content.json
 * - Payload Import only reads src/content/blog/*.md
 * - Empty blog/ → CMS looks empty while live still has posts
 * - Payload-only posts never merge → "articles do not come online"
 */

export const EXPECTED_TENANT = 'schoonmakerweb';
export const EXPECTED_GITHUB_REPO = 'zbseollp/schoonmakerweb';

/**
 * Clock / timezone skew only. Scheduled posts must NOT go live days early.
 * (Was 48h — that made "schedule for next week" show immediately.)
 */
export const FUTURE_SLACK_MS = 2 * 60 * 60 * 1000;

export const MIN_CANARY_COUNT = 5;
/** Defaults only used when floor files are missing (ensure-floors restores/ratchets). */
export const DEFAULT_COUNT_FLOOR = 180;
export const DEFAULT_PUBLISHED_FLOOR = 162;

/** Throwaway / stub slugs — never list or build routes. */
export const TEST_SLUGS = new Set([
  'hello-world',
  'blog-template',
  'test',
  'test-test',
  'daniel',
]);

export function isTestSlug(slug) {
  const s = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
  if (!s) return true;
  if (TEST_SLUGS.has(s)) return true;
  // Exact throwaways only — do not hide real titles like "daniel-lissing-partner".
  if (/^test(-test)?$/i.test(s)) return true;
  return false;
}

/** True when pubDate is still in the future (beyond clock skew). */
export function isScheduledFuture(dateValue, now = Date.now()) {
  if (!dateValue) return false;
  const t = Date.parse(String(dateValue));
  if (Number.isNaN(t)) return false;
  return t > now + FUTURE_SLACK_MS;
}
