# Schoonmakerweb

Astro 5 statische site voor **schoonmakerweb.nl**, 1-op-1 overgezet vanaf
WordPress.

Uitgerold op Cloudflare Workers in het account **info@zb-marketing.com**
(`aa20277e...`, subdomein `twilight-breeze-d943`):

- https://schoonmakerweb.twilight-breeze-d943.workers.dev

Koppel `schoonmakerweb.nl` / `www` alleen in het **Cloudflare-dashboard** aan
deze Worker. Zet **geen** `routes` / `custom_domain` in `wrangler.toml` —
dat breekt de Jenkins-deploy.

Publish-gates zitten in `npm run build` (prepare → assert → astro build →
assert `--dist` → guard-deploy). Spam/off-topic/malware posts blijven in
`src/data/content.json` maar worden via `src/data/spam-slugs.json` verborgen;
casino-affiliate links en scripts worden uit live bodies gestript. Malware
images (Gameshub/poker) worden verwijderd in prepare.

**Do not bypass these gates.** Jenkins runs `npm run build` only. Removing
`assert-publish-ready`, `guard-deploy`, or the floor files will fail the build
on purpose so “articles do not come online” cannot return silently.

## Commando's

```bash
npm install
npm run dev
npm run build
npm run deploy    # build + wrangler deploy
```

## URL-structuur

| Pad | Inhoud |
| --- | --- |
| `/` | voorpagina |
| `/{slug}/` | 193 blogs, 96 vergelijkingspagina's en de losse pagina's |
| `/blog/` | de blogpagina van de oude site |
| `/category/blog/`, `/category/blog/page/{n}/` | blogarchief, 10 per pagina |
| `/author/lisanne/`, `/author/info_809y5sr2/` (+ `/page/{n}/`) | auteursarchieven |
| `/sitemap/` | de HTML-sitemap die de oude site ook had |
| `/sitemap-index.xml` | XML-sitemap |
| `/feed.xml`, `/feed/` | RSS-feed (de Worker serveert hem op beide paden) |

## De 96 vergelijkingspagina's

De "beste ..."-pagina's zijn een eigen posttype in WordPress (`zb_mp`) dat
**niet** via de REST API beschikbaar is. Die zijn daarom uit de HTML-spiegel
gehaald: het Elementor-blok met `data-elementor-type="wp-page"`, tussen de
header en de footer.

De **959 affiliate-links naar partner.bol.com** zijn ongewijzigd overgenomen,
inclusief `rel` en `target`. Dat is nagemeten op de gebouwde HTML: 959 links
verdeeld over 96 pagina's, gelijk aan de bron.

## Waar de inhoud vandaan komt

| Script | Doel |
| --- | --- |
| `migration/scripts_fetch.py` | REST-collecties + sitemap + HTML-spiegel van alle 300 URL's |
| `migration/scripts_build_content.py` | REST + spiegel → `src/data/content.json` |
| `migration/scripts_collect_images.py` | verzamelt alle afbeeldings-URL's, ook uit srcset |
| `migration/scripts_download_images.py` | haalt ze op naar `public/wp-content/uploads/` |
| `migration/scripts_link_check.py` | controleert elke interne link en afbeelding in `dist/` |

Twee dingen waren op deze installatie stuk en zijn omzeild:

- de REST-endpoint voor berichten geeft een 500 bij `per_page=100` of met een
  `orderby`-parameter; met `per_page=50` loopt hij wel door;
- de users-endpoint geeft een 403, dus de auteursnamen komen uit de
  `<h1>` van de auteursarchieven en de koppeling loopt via het author-id uit
  de berichten (1 = admin, 5 = Lisanne).

## Bekende kapotte links

In de blogteksten staan 21 interne links naar slugs die niet bestaan, zoals
`/vloertypen-onderhouden/` en `/ergonomische-houding-schoonmaakwerk/`. Die
geven **op de oude site ook al een 404**; ze zijn 1-op-1 overgenomen en niet
stilzwijgend weggehaald. `migration/scripts_link_check.py` laat ze zien.

## Ontwerp

Kleuren en typografie komen uit de Elementor-kit van de oude site: bordeaux
`#722B31` als primaire kleur, marineblauw `#04195A` als accent, Poppins voor
de koppen en Inter voor de tekst.
