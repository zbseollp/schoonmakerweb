"""
Haal een WordPress-site binnen: de REST-collecties plus een HTML-spiegel van
elke URL uit de sitemap.

De REST API geeft schone inhoud; de HTML-spiegel is nodig voor wat daar niet
in zit - de <title> en meta-description van de SEO-plugin, en eventuele
custom post types die niet via REST beschikbaar zijn.

Gebruik:
    python scripts_fetch.py <domein>
bijvoorbeeld:
    python scripts_fetch.py krant.news
"""
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

DOMAIN = sys.argv[1] if len(sys.argv) > 1 else None
if not DOMAIN:
    sys.exit("geef het domein mee, bijvoorbeeld: python scripts_fetch.py krant.news")

BASE = f"https://{DOMAIN}"
HERE = Path(__file__).resolve().parent
SRC, MIRROR = HERE / "source", HERE / "mirror"
SRC.mkdir(parents=True, exist_ok=True)
MIRROR.mkdir(parents=True, exist_ok=True)

S = requests.Session()
S.headers.update({"User-Agent": f"{DOMAIN}-migration/1.0"})
lock = threading.Lock()


def fetch_all(endpoint, per_page=100):
    """Alle items van een REST-collectie, pagina voor pagina."""
    items, page = [], 1
    while True:
        # Geen orderby: op sommige installaties laat die parameter de query
        # bij per_page=100 omvallen met een 500. De standaardvolgorde (datum,
        # nieuwste eerst) volstaat; sorteren doen we later toch lokaal.
        params = {"per_page": per_page, "page": page}
        r = S.get(f"{BASE}/wp-json/wp/v2/{endpoint}", params=params, timeout=60)
        if r.status_code == 400 and page > 1:
            break
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        items.extend(batch)
        total = r.headers.get("X-WP-TotalPages")
        print(f"  {endpoint} p{page}/{total} -> {len(items)}", flush=True)
        if total and page >= int(total):
            break
        page += 1
        time.sleep(0.2)
    return items


def sitemap_urls():
    """Alle content-URL's uit de sitemap-index, als paden."""
    paths = set()
    index = S.get(f"{BASE}/sitemap_index.xml", timeout=60).text
    for sub in re.findall(r"<loc>(.*?)</loc>", index):
        try:
            body = S.get(sub, timeout=60).text
        except Exception as e:
            print(f"  FOUT bij {sub}: {e}", flush=True)
            continue
        for loc in re.findall(r"<loc>(.*?)</loc>", body):
            if loc.endswith(".xml"):
                continue
            paths.add(loc.replace(BASE, "") or "/")
        time.sleep(0.15)
    return sorted(paths)


def name_for(path):
    return ("index" if path == "/" else path.strip("/").replace("/", "__")) + ".html"


def main():
    print("== REST-collecties", flush=True)
    for name in ("posts", "pages", "categories", "tags", "media"):
        try:
            data = fetch_all(name)
        except Exception as e:
            print(f"  {name}: overgeslagen ({e})", flush=True)
            continue
        (SRC / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"   {len(data)} -> {name}.json", flush=True)

    print("\n== sitemap", flush=True)
    paths = sitemap_urls()
    (SRC / "sitemap-paths.json").write_text(json.dumps(paths, indent=1), encoding="utf-8")
    print(f"  {len(paths)} URL's", flush=True)

    print("\n== HTML spiegelen", flush=True)
    report = {}

    def grab(path):
        for attempt in range(3):
            try:
                r = S.get(BASE + path, timeout=60)
                if r.status_code == 200:
                    (MIRROR / name_for(path)).write_text(r.text, encoding="utf-8")
                with lock:
                    report[path] = r.status_code
                return
            except Exception as e:
                if attempt == 2:
                    with lock:
                        report[path] = f"ERR {e}"
                time.sleep(2 * (attempt + 1))

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(grab, paths))

    (SRC / "mirror_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    ok = sum(1 for v in report.values() if v == 200)
    print(f"  200: {ok} / {len(paths)}", flush=True)
    for p, v in sorted(report.items()):
        if v != 200:
            print(f"    {v}  {p}", flush=True)


if __name__ == "__main__":
    main()
