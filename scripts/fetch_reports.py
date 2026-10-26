"""List and download annual-report PDFs from a cooperative website.

Works with sites built on the GCMS/Kotchasan "download" module (used by
hnbpcoop.com and many other Thai savings-cooperative sites), where each file
is an <article> with an id="download_<n>" link and the real URL is issued by
an AJAX call.

Usage:
    python scripts/fetch_reports.py list "https://www.hnbpcoop.com/index.php?module=outcame2&cat=2"
    python scripts/fetch_reports.py get  "https://www.hnbpcoop.com/index.php?module=outcame2&cat=2" 254 reports/hnbpcoop
"""
import http.cookiejar
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (coop-statement report fetcher)"


def opener():
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    op.addheaders = [("User-Agent", UA)]
    return op


def list_reports(op, page_url):
    html = op.open(page_url, timeout=60).read().decode("utf-8", errors="replace")
    items = []
    pattern = re.compile(
        r'<h6[^>]*>([^<]*)</h6>.*?id="download_(\d+)".*?icon-calendar[^>]*>([^<]*)</span>\s*<span>([^<]*)</span>',
        re.S,
    )
    for m in pattern.finditer(html):
        items.append({"id": int(m.group(2)), "name": m.group(1).strip(), "uploaded": m.group(3).strip(), "size": m.group(4).strip()})
    return items


def download(op, page_url, file_id, out_dir):
    base = page_url.split("index.php")[0]
    endpoint = urllib.parse.urljoin(base, "index.php/download/model/download/action")
    headers = {"X-Requested-With": "XMLHttpRequest", "Referer": page_url}
    for action in ("download", "downloading"):
        data = urllib.parse.urlencode({"action": action, "id": f"download_{file_id}"}).encode()
        req = urllib.request.Request(endpoint, data=data, headers=headers)
        resp = json.loads(op.open(req, timeout=60).read().decode("utf-8"))
    href = resp.get("href")
    if not href:
        raise SystemExit(f"Server did not return a file link: {resp}")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"report_{file_id}.pdf"
    with op.open(href, timeout=600) as r, open(target, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    return target


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ("list", "get"):
        raise SystemExit(__doc__)
    op = opener()
    page_url = sys.argv[2]
    if sys.argv[1] == "list":
        for it in list_reports(op, page_url):
            print(f'{it["id"]:>5}  {it["uploaded"]:<28} {it["size"]:<20} {it["name"]}')
    else:
        file_id = int(sys.argv[3])
        out_dir = sys.argv[4] if len(sys.argv) > 4 else "reports"
        print(download(op, page_url, file_id, out_dir))


if __name__ == "__main__":
    main()
