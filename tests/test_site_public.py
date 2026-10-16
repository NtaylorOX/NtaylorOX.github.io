"""Content guard: terms that must never appear on the public page or in its sources.

The list is stored encoded so this file does not itself contain the terms. Rebuild with scripts/build_site.py first.
"""
import base64
import json
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / "site"
PUBLIC = SITE / "public" / "index.html"
FORBIDDEN = json.loads(base64.b64decode(
    "WyJsZWFybmluZyByZXBvIiwgImxlYXJuaW5nIHBhdGgiLCAiTExNIEVuZ2luZWVyIDIwMjYiLCAicm9hZG1hcCIsICJoYW5kcy1vbiBwYXRoIiwgImluIHB1YmxpYyIsICJyYW4gb24gYSBHUFUiLCAicnVuIG9uIGEgR1BVIiwgImxsbS1lbmdpbmVlci0yMDI2IiwgInA4YiIsICJPcGVuIHRoZSBsYWIgYW5kIiwgInBoYXNlcy8iLCAicDRfaW5mZXJlbmNlIiwgImxlYXJuaW5nIHBsYW4iLCAicGVyc29uYWwgcHJvamVjdCJd"
))


def _leaks(text: str) -> list[str]:
    text = text.lower()
    return [w for w in FORBIDDEN if w.lower() in text]


def test_built_page_is_clean():
    html = PUBLIC.read_text()
    assert not _leaks(html)
    low = html.lower()
    assert 'id="now"' not in low and "data.now" not in low.replace("typeof data.now", "")


def test_content_json_is_clean():
    text = (SITE / "content" / "site.json").read_text()
    assert not _leaks(text) and '"now"' not in text.lower()


def test_site_sources_are_clean():
    for f in (SITE / "src").iterdir():
        assert not _leaks(f.read_text()), f.name


def test_repo_text_files_are_clean():
    root = SITE.parent
    for f in root.rglob("*"):
        if f.is_file() and ".git" not in f.parts and f.suffix in {".md", ".yml", ".py", ".json", ".js", ".mjs", ".html", ".css"}:
            if f.name == Path(__file__).name:
                continue
            assert not _leaks(f.read_text(errors="ignore")), f
