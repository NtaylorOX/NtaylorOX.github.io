# Developer site

Source for https://ntaylorox.github.io: a single self-contained HTML page with an interactive Lab.

- Content: `site/content/site.json`
- Behaviour: `site/src/app.js`; maths: `site/src/logic.js` (tested by `site/src/logic.test.mjs`)
- Build: `python scripts/build_site.py` writes `site/public/index.html` (commit it; CI checks it is fresh)
- Tests: `python -m pytest tests` and `node site/src/logic.test.mjs`

Pushes to `main` deploy to GitHub Pages via `.github/workflows/pages.yml`.
