# Ascent Academia · VCE Study Score & ATAR Calculator

A web app by [Ascent Academia](https://ascentacademia.com.au/) that estimates VCE study scores and ATARs using only official VCAA and VTAC data.

- **Study score estimator**: enter SAC and exam percentages for any of 117 studies. It uses VCAA's statewide results for every graded assessment (mean, standard deviation, grade cut-offs and grade counts), the official weighting of each assessment and VCAA's published study score formula. It shows your grade on each assessment, your estimated study score with a likely range, and the exam score you need to reach a target.
- **SAC moderation estimate**: pick your school and enter each SAC % with your class average (or just your rank). It approximates VCAA's statistical moderation, which keeps your distance from the class average and rescales it to the school's statewide level. The school's level comes from its published median study score and share of 40+ scores (2023–2025). Your raw and moderated SAC are shown side by side.
- **ATAR calculator**: turns study scores into VTAC scaled scores, then builds the aggregate using VTAC's rules: English plus the best three in the primary four, 10% increments cut to 2 decimal places, grouping limits, equivalent studies, non-scored VET and higher education increments. The aggregate converts to an ATAR with VTAC's official aggregate-to-ATAR table.
- **Scaling explorer**: every study's scaled scores for 2021–2025, sortable, with the change from the previous year.

## Accuracy

| Step | Source | Check |
| --- | --- | --- |
| Scaled scores | VTAC Scaling Reports 2021–2025 (integers at study scores 20, 25, …, 50) | Monotone cubic (PCHIP) interpolation; mean absolute error 0.20 (max 0.53) against all 23 two-decimal scaled scores in VTAC's own worked examples |
| Aggregate → ATAR | VTAC aggregate-to-ATAR tables 2021–2025 (every 0.05 ATAR step) | Exact lookup; reproduces VTAC's worked examples (172.32 → 95.65, 136.17 → 80.30, 195.71 → 99.30, 103.36 → 57.15) |
| Study score | VCAA 2025 grade distributions + VCAA assessment summary weights (117 catalogue entries with assessment data) | Implements VCAA's method; the joint spread of students' results across assessments is simulated (Gaussian copula, correlation 0.8, range 0.7–0.9) because VCAA doesn't publish it |
| SAC moderation | VCAA Senior Secondary Completion and Achievement Information 2023–2025 (555 schools) | Rescales your position in the class (SAC vs class average, or rank) to the school's statewide level (median study score) and spread (% of study scores 40+); returns the statewide spread for statewide inputs |

Limits: the moderation estimate uses whole-school results, not the specific study's cohort, and VCAA's real adjustment uses your classmates' exam results, which aren't known in advance. Future years' scaling, grade cut-offs and ATAR tables will differ slightly from the latest published year.

## Development

Use **Node.js 22** (the version used by CI), with npm. The checked-in data contains
127 study entries, 117 with assessment data, scaling/ATAR tables for 2021–2025,
and 555 schools with results across 2023–2025. Normal development uses these JSON
files directly; fetching the source documents is only needed when rebuilding data.

```bash
npm ci             # install the locked dependencies
npm run dev        # local Vite dev server
npm run lint       # oxlint, also run by CI
npm test           # engine tests (Vitest, one run)
npm run build      # TypeScript check + static site in dist/
npm run preview    # serve the built site locally
```

The React interface lives in `src/`, calculation rules and their tests in
`src/lib/`, and generated official data in `src/data/`. Vite uses a relative
base (`./`), so `dist/` can be served from a GitHub Pages project path or another
static host.

## Updating the data

Every figure in `src/data/` is generated from the official files:

```bash
npm run data:fetch   # downloads VTAC/VCAA PDFs and pages into data/raw/ (git-ignored)
npm run data:build   # parses them into src/data/studies.json, atar.json and schools.json
```

To add a new year, add its VTAC report filenames to `scripts/sources.mjs`, bump
`GA_YEAR` when VCAA publishes new grade distributions (usually around April), and
update `SSCAI_YEARS` when new school results are available. Fetch and build, then
run `npm test` and `npm run build` before committing the generated JSON. The build
script checks the parsed data: ATAR tables must be contiguous in 0.05 steps,
scaling rows must be monotone, grade counts must add up and weights must total 100%.

Sources:
- VTAC scaling reports and aggregate-to-ATAR tables: https://vtac.edu.au/reports and https://vtac.edu.au/reports/archive
- VCAA grade distributions for graded assessments: https://www.vcaa.vic.edu.au/administration/school-administration/performance-senior-secondary
- VCAA assessment weightings: https://www.vcaa.vic.edu.au/administration/vce-administrative-handbook/vce-and-vet-assessment-summary
- VCAA study score method: https://www.vcaa.vic.edu.au/administration/vce-administrative-handbook/score-aggregation
- VTAC aggregate rules: https://vtac.edu.au/guides/atar-scaling-guide-2026.html

## Deployment

`.github/workflows/deploy.yml` installs locked dependencies, runs lint and tests,
and builds on pull requests, pushes to `main` and manual dispatch. It publishes
`dist/` to GitHub Pages only for non-PR runs on `main`. Turn it on in the repository
under **Settings → Pages → Source: GitHub Actions**.

This is an independent estimate and is not affiliated with VCAA or VTAC.

## Self-hosted build routing

These workflows prefer `ASCENT_RUNNER_LINUX`, then `ASCENT_RUNNER_WINDOWS`,
each containing a JSON array of self-hosted OS/X64 labels. Legacy
`ASCENT_RUNNER` maps to Windows only. Without a variable they use hosted Ubuntu.
Start an eligible Ascent Portable Builder session before dispatching a workflow.
Node/collection dependencies are installed by the workflow; routing does not
change collection budgets, job triggers or deploy permissions.
