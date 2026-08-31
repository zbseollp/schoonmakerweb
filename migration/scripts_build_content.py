"""
Zet schoonmakerweb.nl om naar src/data/content.json.

Drie soorten inhoud:

1. berichten en pagina's - schoon uit de REST API;
2. de 96 "magic pages" (custom post type zb_mp) - die zitten NIET in de REST
   API, dus die komen uit de HTML-spiegel: het Elementor-blok met
   data-elementor-type="wp-page", tussen de header en de footer;
3. de SEO-meta - Yoast zet <title> en meta-description niet in de REST API,
   dus die komt voor alles uit de spiegel.

De affiliate-links naar partner.bol.com blijven ongemoeid; die zijn de
verdienkant van de magic pages.
"""
import html as H
import json
import re
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC, MIRROR = HERE / "source", HERE / "mirror"
OUT = HERE.parent / "src" / "data"
OUT.mkdir(parents=True, exist_ok=True)
DOMAIN = "https://schoonmakerweb.nl"

KEEP = {"h1","h2","h3","h4","h5","h6","p","ul","ol","li","strong","em","b","i",
        "br","a","img","blockquote","figure","figcaption","table","thead",
        "tbody","tr","th","td","hr","span"}
VOID = {"br", "img", "hr"}
KEEP_ATTRS = {"a": {"href", "rel", "target", "title"},
              "img": {"src", "alt", "width", "height", "loading"}}


class Cleaner(HTMLParser):
    """Houdt de semantische inhoud over en gooit de Elementor-divs weg."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.out = []
        self.skip_tag = None
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg", "form", "iframe"):
            self.skip_tag, self.skip_depth = tag, 1
            return
        if self.skip_tag:
            if tag == self.skip_tag:
                self.skip_depth += 1
            return
        if tag not in KEEP:
            return
        allowed = KEEP_ATTRS.get(tag, set())
        parts = []
        for k, v in attrs:
            if k not in allowed or v is None:
                continue
            if k in ("href", "src"):
                v = v.replace(DOMAIN, "")   # eigen links relatief; externe blijven heel
            parts.append(f' {k}="{H.escape(v, quote=True)}"')
        self.out.append(f"<{tag}{''.join(parts)}>")

    def handle_endtag(self, tag):
        if self.skip_tag:
            if tag == self.skip_tag:
                self.skip_depth -= 1
                if self.skip_depth == 0:
                    self.skip_tag = None
            return
        if tag in KEEP and tag not in VOID:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skip_tag:
            self.out.append(data)

    def handle_entityref(self, name):
        if not self.skip_tag:
            self.out.append(f"&{name};")

    def handle_charref(self, name):
        if not self.skip_tag:
            self.out.append(f"&#{name};")


def tidy(html):
    c = Cleaner()
    c.feed(html)
    c.close()
    out = "".join(c.out)
    for _ in range(5):
        out = re.sub(r"<(p|li|h[1-6]|ul|ol|strong|em|span)>\s*</\1>", "", out)
    out = re.sub(r"<span>(.*?)</span>", r"\1", out, flags=re.S)   # kale spans weg
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"(\s*\n\s*){2,}", "\n", out)
    return out.strip()


def name_for(path):
    return ("index" if path == "/" else path.strip("/").replace("/", "__")) + ".html"


def mirror_html(path):
    f = MIRROR / name_for(path)
    return f.read_text(encoding="utf-8", errors="replace") if f.exists() else ""


def head_meta(path):
    h = mirror_html(path)
    if not h:
        return {}
    head = h.split("</head>")[0]

    def pick(p):
        m = re.search(p, head, re.I | re.S)
        return H.unescape(m.group(1)).strip() if m else ""

    return {
        "seoTitle": pick(r"<title>(.*?)</title>"),
        "seoDescription": pick(r'<meta name="description" content="(.*?)"'),
        "canonical": pick(r'<link rel="canonical" href="(.*?)"'),
        "ogImage": pick(r'<meta property="og:image" content="(.*?)"').replace(DOMAIN, ""),
    }


def page_block(path):
    """Het Elementor-blok van de pagina zelf, dus zonder header en footer."""
    h = mirror_html(path)
    if not h:
        return ""
    start = h.find('data-elementor-type="wp-page"')
    if start < 0:
        return ""
    start = h.rfind("<div", 0, start)
    end = h.find('data-elementor-type="footer"', start)
    if end < 0:
        end = len(h)
    else:
        end = h.rfind("<footer", start, end)
        if end < 0:
            end = len(h)
    return h[start:end]


def clean_text(text, limit=None):
    t = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()
    if limit and len(t) > limit:
        t = t[: t.rfind(" ", 0, limit)] + "…"
    return t


def load(name):
    f = SRC / f"{name}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []


cats = {c["id"]: {"slug": c["slug"], "name": H.unescape(c["name"])} for c in load("categories")}
tags = {t["id"]: {"slug": t["slug"], "name": H.unescape(t["name"])} for t in load("tags")}
media = {m["id"]: m["source_url"].replace(DOMAIN, "") for m in load("media")}


def from_rest(item, kind):
    path = item["link"].replace(DOMAIN, "") or "/"
    rec = {
        "slug": item["slug"],
        "path": path,
        "kind": kind,
        "title": H.unescape(item["title"]["rendered"]),
        "date": item["date"],
        "modified": item["modified"],
        "content": item["content"]["rendered"].replace(DOMAIN + "/", "/").replace(DOMAIN, ""),
        "excerpt": clean_text(item.get("excerpt", {}).get("rendered", ""), 200),
        "categories": [cats[c] for c in item.get("categories", []) if c in cats],
        "tags": [tags[t] for t in item.get("tags", []) if t in tags],
        "featuredImage": media.get(item.get("featured_media"), ""),
        "author": item.get("author"),
    }
    rec.update(head_meta(path))
    return rec


posts = [from_rest(p, "post") for p in load("posts")]
pages = [from_rest(p, "page") for p in load("pages")]

# Pagina's die met Elementor zijn gebouwd leveren via REST alleen divs op;
# haal daar de inhoud uit de spiegel, net als bij de magic pages.
for rec in pages:
    if "data-elementor-type" in rec["content"] or "elementor-element" in rec["content"]:
        block = page_block(rec["path"])
        if block:
            rec["content"] = tidy(block)

known = {p["path"] for p in posts} | {p["path"] for p in pages}
sitemap = json.loads((SRC / "sitemap-paths.json").read_text(encoding="utf-8"))

magic = []
for path in sitemap:
    if path in known or path == "/" or path.startswith(("/author/", "/category/")):
        continue
    block = page_block(path)
    if not block:
        print(f"  ! geen inhoud gevonden: {path}")
        continue
    h = mirror_html(path)
    h1 = clean_text(re.search(r"<h1[^>]*>(.*?)</h1>", h, re.S).group(1)) if re.search(r"<h1", h) else ""
    rec = {
        "slug": path.strip("/"),
        "path": path,
        "kind": "magic",
        "title": h1,
        "date": "", "modified": "",
        "content": tidy(block),
        "excerpt": "",
        "categories": [], "tags": [],
        "featuredImage": "",
    }
    rec.update(head_meta(path))
    # De og:image is op alle 96 pagina's dezelfde site-brede fallback en het
    # bestand bestaat niet eens meer. De eerste productfoto uit de pagina zelf
    # is wel per pagina anders en laadt van dezelfde host als op de oude site.
    first = re.search(r'<img[^>]+src="([^"]+)"', rec["content"])
    rec["featuredImage"] = first.group(1) if first else ""
    magic.append(rec)

posts.sort(key=lambda r: r["date"], reverse=True)
magic.sort(key=lambda r: r["title"])

data = {
    "posts": posts,
    "pages": pages,
    "magic": magic,
    "categories": sorted(cats.values(), key=lambda c: c["name"]),
    "tags": sorted(tags.values(), key=lambda t: t["name"]),
}
(OUT / "content.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

alles = posts + pages + magic
print(f"berichten: {len(posts)}   pagina's: {len(pages)}   magic pages: {len(magic)}")
print(f"zonder seoTitle: {sum(1 for r in alles if not r.get('seoTitle'))}")
print(f"zonder inhoud:   {sum(1 for r in alles if len(r['content']) < 200)}")
aff = sum(len(re.findall(r"partner\.bol\.com", r["content"])) for r in alles)
print(f"affiliate-links behouden: {aff}")
print(f"content.json: {(OUT / 'content.json').stat().st_size / 1e6:.1f} MB")
