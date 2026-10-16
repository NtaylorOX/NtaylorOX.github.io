"""Inline site/src/* into one self-contained page: site/public/index.html

    python scripts/build_site.py && node site/src/logic.test.mjs

Edit content in site/content/site.json; behaviour in site/src/app.js; maths in site/src/logic.js (tested with node).
The result is a single HTML file with no build tooling and no runtime dependencies besides Google Fonts (optional).
"""
from __future__ import annotations

import json
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / "site"


def main() -> None:
    tpl = (SITE / "src" / "index.template.html").read_text(encoding="utf-8")
    css = (SITE / "src" / "style.css").read_text(encoding="utf-8")
    logic = (SITE / "src" / "logic.js").read_text(encoding="utf-8")
    app = (SITE / "src" / "app.js").read_text(encoding="utf-8")
    data = json.loads((SITE / "content" / "site.json").read_text(encoding="utf-8"))
    # `</` inside inline JSON could end the script tag early; escape it.
    data_js = "var DATA = " + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") + ";"
    # logic.js declares top-level consts; app.js reads them through a single namespace L.
    logic_js = logic.split("if (typeof module")[0] + (
        "\nvar L = { SPECS: SPECS, GPUS: GPUS, kvBytesPerToken: kvBytesPerToken, plan: plan, decodeTps: decodeTps,"
        " lengths: lengths, staticSchedule: staticSchedule, continuousSchedule: continuousSchedule,"
        " evalNoise: evalNoise, itemsFor: itemsFor, phi: phi, guardrail: guardrail };\n"
    )
    html = tpl.replace("/*CSS*/", css).replace("/*DATA*/", data_js).replace("/*LOGIC*/", logic_js).replace("/*APP*/", app)
    out = SITE / "public" / "index.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
