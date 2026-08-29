"""
Controleer elke interne link in de gebouwde site: bestaat de pagina waar hij
naartoe wijst, en bestaat elke afbeelding die wordt opgevraagd?
"""
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST, PUBLIC = ROOT / "dist", ROOT / "public"

pages = {"/"}
assets = set()
for p in DIST.rglob("*"):
    if not p.is_file():
        continue
    rel = "/" + p.relative_to(DIST).as_posix()
    if p.name == "index.html":
        parent = p.relative_to(DIST).parent.as_posix()
        pages.add("/" if parent == "." else f"/{parent}/")
    assets.add(rel)

bad_links = Counter()
bad_images = Counter()
external = set()

HREF = re.compile(r'href="([^"#]+)"')
SRC = re.compile(r'<img[^>]+src="([^"]+)"')

for f in DIST.rglob("index.html"):
    html = f.read_text(encoding="utf-8", errors="replace")
    where = "/" + f.relative_to(DIST).parent.as_posix().replace(".", "").strip("/")
    for href in HREF.findall(html):
        if href.startswith(("http://", "https://", "mailto:", "tel:", "//")):
            external.add(href.split("/")[2] if "//" in href else href)
            continue
        if not href.startswith("/"):
            continue
        target = href.split("?")[0]
        if target in pages or target in assets:
            continue
        bad_links[f"{target}  (o.a. op {where})"] += 1
    for src in SRC.findall(html):
        if src.startswith("/") and src not in assets and not (PUBLIC / src.lstrip("/")).exists():
            bad_images[src] += 1

print(f"pagina's in dist: {len(pages)}   bestanden: {len(assets)}")
print(f"\ngebroken interne links: {len(bad_links)}")
for k, n in bad_links.most_common(20):
    print(f"  {n:>4}x  {k}")
print(f"\nontbrekende afbeeldingen: {len(bad_images)}")
for k, n in bad_images.most_common(20):
    print(f"  {n:>4}x  {k}")
print(f"\nexterne hosts waarnaar gelinkt wordt: {sorted(external)[:10]}")
