/**
 * Runtime publish rules for listings + routes.
 * Keep in sync with scripts/lib/publish-guards.mjs (same constants / intent).
 */

/** Clock skew only — scheduled posts go live on their date, not days early. */
export const FUTURE_SLACK_MS = 2 * 60 * 60 * 1000;

export const TEST_SLUGS = new Set([
  "hello-world",
  "blog-template",
  "test",
  "test-test",
  "daniel",
]);

export function isTestSlug(slug: string | undefined | null): boolean {
  const s = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
  if (!s) return true;
  if (TEST_SLUGS.has(s)) return true;
  if (/^test(-test)?$/i.test(s)) return true;
  return false;
}

export function isScheduledFuture(dateValue: string | undefined | null, now = Date.now()): boolean {
  if (!dateValue) return false;
  const t = Date.parse(String(dateValue));
  if (Number.isNaN(t)) return false;
  return t > now + FUTURE_SLACK_MS;
}
