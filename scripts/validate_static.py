#!/usr/bin/env python3
"""Validate local static asset references without external dependencies."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]


class ReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name in {"href", "src"} and value:
                self.references.append(value)


def main() -> None:
    missing: list[str] = []
    for html_file in ROOT.glob("*.html"):
        parser = ReferenceParser()
        parser.feed(html_file.read_text(encoding="utf-8"))
        for reference in parser.references:
            parsed = urlsplit(reference)
            if parsed.scheme or reference.startswith(("#", "//")) or not parsed.path:
                continue
            target = (html_file.parent / parsed.path).resolve()
            if not target.is_relative_to(ROOT) or not target.exists():
                missing.append(f"{html_file.name}: {reference}")
    if missing:
        raise SystemExit("Missing or unsafe references:\n" + "\n".join(missing))
    print("STATIC_REFERENCES_OK")


if __name__ == "__main__":
    main()
