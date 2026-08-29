"""
Verzamel alle afbeeldings-URL's uit de gespiegelde HTML. Elementor zet
afbeeldingen niet alleen in src maar ook in srcset, data-src en
background-image, dus we zoeken op de hele tekst in plaats van per attribuut.

Naast elke gevonden variant (-1024x683) nemen we ook het origineel mee, zodat
bestaande image-URL's blijven werken.
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOMAIN = "https://schoonmakerweb.nl"

PATTERN = re.compile(
    r"https://schoonmakerweb.nl(/wp-content/uploads/[^\s\"'),\\]+?\.(?:jpe?g|png|webp|gif|svg))",
    re.IGNORECASE,
)
VARIANT = re.compile(r"-\d+x\d+(?=\.\w+$)")

urls = set()
for f in (HERE / "mirror").glob("*.html"):
    urls.update(PATTERN.findall(f.read_text(encoding="utf-8", errors="replace")))

originals = {VARIANT.sub("", u) for u in urls}
allof = sorted(urls | originals)

(HERE / "source" / "images.txt").write_text(
    "\n".join(DOMAIN + u for u in allof), encoding="utf-8")

print(f"varianten gevonden: {len(urls)}")
print(f"inclusief originelen: {len(allof)}")
for u in allof[:8]:
    print("  ", u)
