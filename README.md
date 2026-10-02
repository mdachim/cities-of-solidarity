# Cities of Solidarity Moldova

**Cities of Solidarity Moldova** is a static website presenting UNHCR Moldova’s work with Moldovan municipalities to strengthen refugee inclusion through local governance, public service delivery and development planning.

The website introduces the Cities of Solidarity approach, explains the role of Local Action Plans, and brings together comparative city data, municipal action ideas and document links for Comrat, Bălți, Chișinău and Cahul.

## About the initiative

Cities of Solidarity supports municipalities to integrate refugee inclusion into local systems rather than creating parallel arrangements. The approach is locally owned, evidence-based and investment-oriented: each participating city develops a Local Action Plan that translates urban analysis, socio-economic evidence and municipal priorities into a practical portfolio of actions.

The aim is to strengthen services and opportunities for both refugees and host communities, while helping municipalities identify actions that can be financed, scaled or replicated across cities.

## What the website includes

- **Home page** — introduction to the initiative and the four participating cities.
- **About page** — explanation of the Cities of Solidarity approach and ecosystem.
- **Four Cities comparison** — a data story comparing inclusion pathways across Comrat, Bălți, Chișinău and Cahul.
- **Action Bank** — a searchable set of municipal action ideas across sectors.
- **Results Showcase** — an interactive map and portfolio of UNHCR-funded communal infrastructure projects across Moldova.
- **Methodology page** — the six-step process behind the Local Action Plans and the investment logic for scale-up.
- **LAP Library** — document links for Local Action Plans in English, Romanian and Russian.

## Repository structure

```text
/
├── index.html              Home page
├── about.html              About Cities of Solidarity
├── comparison.html         Four Cities comparison data story
├── action-bank.html        Searchable Action Bank
├── results.html            Results Showcase map and project portfolio
├── methodology.html        Methodology and investment logic
├── library.html            LAP Library
├── 404.html                Custom GitHub Pages 404 page
├── .nojekyll               GitHub Pages configuration file
│
├── css/                    Website styles
├── js/                     Website scripts
├── data/                   Editable data files used by the website
├── documents/              Local Action Plan PDFs
└── assets/                 Logos, favicon and visual assets
```

The website is fully static. It uses HTML, CSS and JavaScript only. There is no backend, no database and no build step.

## Data and documents

The website reads JSON files in the `data/` folder at runtime. Each one is generated from a matching Excel file, which is the human-editable master — the `.xlsx` files stay local only (see `.gitignore`) and are never published to the repository.

```text
data/city_comparison.xlsx   Editable master (local only, gitignored)
data/city_comparison.json   Live file read by the website

data/action_bank.xlsx       Editable master (local only, gitignored)
data/action_bank.json       Live file read by the website

data/results_showcase.xlsx  Editable master (local only, gitignored)
data/results_showcase.json  Live file read by the website
```

To update the data: edit the relevant Excel file, then run its matching build script from the repository root, then commit and push the regenerated JSON (the `.xlsx` itself is never committed):

```text
python build_comparison_data.py    # data/city_comparison.xlsx  -> .json
python build_action_bank.py        # data/action_bank.xlsx      -> .json
python build_results_showcase.py   # data/results_showcase.xlsx -> .json
```

All three require `pip install openpyxl`. For the Results Showcase, `build_results_showcase.py` also auto-detects project photos from `assets/photos/<project_id>/` — see `assets/photos/README.md` and `SETUP_RESULTS_SHOWCASE.md`.

`seed_action_bank.py` and `seed_comparison_data.py` are historical one-time scripts that originally generated the `.xlsx` masters from hand-coded data — they are not part of the live pipeline and should not be re-run (doing so would overwrite any manual edits made in Excel since).

The Local Action Plan download buttons point to fixed files in the `documents/` folder. To publish or replace a plan, upload the final PDF using the same file name, for example:

```text
documents/comrat-lap-en.pdf
documents/comrat-lap-ro.pdf
documents/comrat-lap-ru.pdf
```

The same naming structure is used for Bălți, Chișinău and Cahul.

## Running the website locally

Because some pages load JSON files with JavaScript, the website should be opened through a small local server rather than directly from the file system.

Using Python:

```bash
cd path/to/repository
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Alternatively, the site can be previewed with the Live Server extension in Visual Studio Code.

## Technical notes

- All links are relative, so the website can run either from a root domain or from a GitHub Pages project path.
- The `.nojekyll` file is included so GitHub Pages serves the static files directly.
- The Results Showcase map uses Leaflet with a vector base layer (Moldova's administrative boundaries, from `assets/map/moldova_admin_data.js`) instead of raster map tiles — no API key or account is required.
- Fonts are loaded from Google Fonts. If offline hosting is required, fonts can be self-hosted or replaced with system fonts.
- The `build_*.py` scripts regenerate the published JSON from the local Excel masters (see "Data and documents" above) — they aren't required to just serve the already-published site, only to publish new edits.

## Maintainer note

This repository is intended to support public communication, partner engagement and continued development of the Cities of Solidarity Moldova platform. Content, data files and document links should be reviewed before publication to ensure that they reflect the latest approved versions.
