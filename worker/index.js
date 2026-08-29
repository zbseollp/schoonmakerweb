/**
 * Deze Worker draait in het account van info@zb-marketing.com. Het
 * productiedomein hangt er nog niet aan; zolang dat zo is wordt de sitemap
 * op de workers.dev-URL geserveerd met dat domein erin herschreven.
 *
 * Twee dingen die de statische assets zelf niet kunnen:
 *
 * 1. De XML-sitemap bevat absolute URL's met het productiedomein. Op een
 *    preview-URL wijst die dan naar een host die daar niets serveert. Deze
 *    Worker herschrijft het domein naar de host waarop hij wordt opgevraagd;
 *    op het echte domein is dat een no-op.
 * 2. WordPress serveerde de RSS-feed op /feed/. Astro bouwt hem als /feed.xml,
 *    dus /feed/ wordt hier doorgegeven aan dat bestand.
 *
 * De ETag van het bronbestand hoort NIET ongewijzigd terug bij een herschreven
 * body: anders levert een revalidatie een 304 op en blijft er een oude versie
 * in de browsercache hangen.
 */
const CANONICAL = 'https://schoonmakerweb.nl';
const SITEMAP = /^\/sitemap[\w.-]*\.xml$/;
const ALIAS = {
  '/sitemap.xml': '/sitemap-index.xml',
  '/sitemap_index.xml': '/sitemap-index.xml',
  '/feed/': '/feed.xml',
  '/feed': '/feed.xml',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const alias = ALIAS[url.pathname];
    if (!SITEMAP.test(url.pathname) && !alias) return env.ASSETS.fetch(request);

    // Zonder conditionele headers opvragen, zodat we altijd een volledige body
    // krijgen om te herschrijven (nooit een kaal 304'tje).
    const assetRequest = new Request(new URL(alias || url.pathname, url).toString(), {
      method: 'GET',
      headers: {},
    });
    const response = await env.ASSETS.fetch(assetRequest);
    if (!response.ok) return response;

    const body = (await response.text()).split(CANONICAL).join(url.origin);

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('last-modified');
    headers.delete('etag');
    headers.set('content-type', 'application/xml; charset=utf-8');
    headers.set('cache-control', 'no-store, must-revalidate');

    return new Response(body, { status: 200, headers });
  },
};
