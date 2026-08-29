"""
Download de afbeeldingen naar public/, met exact hetzelfde pad als op de oude
site (/wp-content/uploads/...). Zo blijven bestaande image-URL's geldig.
"""
import re
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import requests

HERE = Path(__file__).resolve().parent
PUB = HERE.parent / "public"
urls = [u for u in (HERE / "source" / "images.txt").read_text(encoding="utf-8").split() if u]
S = requests.Session()
S.headers.update({"User-Agent": "schoonmakerweb-migration/1.0"})
lock = threading.Lock()
log = []

# In de mediabibliotheek van de oude site stonden twee PHP-payloads die als
# .jpg waren geupload (w2sxf73506*.php_.jpg, juli 2026). Alles wat op PHP lijkt
# wordt hier geweigerd - zulke bestanden horen niet in public/.
BLOCKED = re.compile(r"\.(php|phtml|phar|cgi|pl|py|sh)[._]", re.I)

def grab(url):
    rel = url.split("schoonmakerweb.nl/", 1)[1]
    if BLOCKED.search(rel):
        with lock: log.append(("GEWEIGERD", url)); return
    dest = PUB / rel
    if dest.exists() and dest.stat().st_size > 0:
        with lock: log.append(("SKIP", url)); return
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        r = S.get(url, timeout=60)
        if r.status_code == 200 and r.content:
            dest.write_bytes(r.content)
            with lock: log.append(("OK", url))
        else:
            with lock: log.append((f"FAIL {r.status_code}", url))
    except Exception as e:
        with lock: log.append((f"ERR {e}", url))

with ThreadPoolExecutor(max_workers=8) as ex:
    list(ex.map(grab, urls))

(HERE / "source" / "_image_download.log").write_text(
    "\n".join(f"{s}\t{u}" for s, u in sorted(log)), encoding="utf-8")
from collections import Counter
print(Counter(s.split()[0] for s, _ in log))
for s, u in log:
    if not s.startswith(("OK", "SKIP")):
        print(" ", s, u)
