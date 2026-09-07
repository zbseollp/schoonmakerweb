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
export const EXPECTED_CF_ACCOUNT = 'aa20277e66394b81d65252fd5708e2c0';
export const FUTURE_SLACK_MS = 48 * 60 * 60 * 1000;
export const MIN_CANARY_COUNT = 5;
export const DEFAULT_COUNT_FLOOR = 180;
export const DEFAULT_PUBLISHED_FLOOR = 162;
