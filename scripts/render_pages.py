"""Render PDF pages to PNG so scanned Thai reports can be read and transcribed.

Annual reports are usually scanned images (or use fonts without a Unicode
map), so text extraction returns only digits. Render the statement pages and
transcribe them into data/<coop>-<year>.js.

Requires pypdfium2 (installed with pdfplumber):  pip install pypdfium2

Usage:
    python scripts/render_pages.py report.pdf out/page 41-50 [scale]
    python scripts/render_pages.py report.pdf - count
"""
import sys

import pypdfium2 as pdfium


def parse_pages(spec):
    pages = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            pages.extend(range(int(a), int(b) + 1))
        else:
            pages.append(int(part))
    return pages


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    pdf = pdfium.PdfDocument(sys.argv[1])
    if sys.argv[3] == "count":
        print(len(pdf))
        return
    prefix = sys.argv[2]
    scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.8
    for p in parse_pages(sys.argv[3]):
        if 1 <= p <= len(pdf):
            img = pdf[p - 1].render(scale=scale).to_pil()
            path = f"{prefix}_p{p:03d}.png"
            img.save(path)
            print(path, img.size)


if __name__ == "__main__":
    main()
