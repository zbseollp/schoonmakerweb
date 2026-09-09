/**
 * Permanent redirects for URLs the site no longer builds.
 *
 * /category/blog/ was the paginated archive while /blog/ showed a hand-picked
 * twelve. /blog/ is the archive now and the category routes are gone, but their
 * 20 pages are indexed, so they redirect rather than 404.
 *
 * Imported by both worker/index.js (which serves the redirect) and
 * scripts/guard-deploy.mjs (which must not read a redirected URL as content
 * loss). Keep it dependency-free so both can use it.
 */

/** @returns {string|null} target path, or null when nothing should redirect. */
export function redirectFor(pathname) {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;

  // /category/<any>/page/<n>/ → /blog/page/<n>/
  const paged = path.match(/^\/category\/[^/]+\/page\/(\d+)\/$/);
  if (paged) return paged[1] === '1' ? '/blog/' : `/blog/page/${paged[1]}/`;

  // /category/ and /category/<any>/ → /blog/
  if (/^\/category(\/[^/]+)?\/$/.test(path)) return '/blog/';

  return null;
}
