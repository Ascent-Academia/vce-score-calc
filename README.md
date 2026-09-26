# Ascent Academia · VCE Study Score & ATAR Calculator

A web app by [Ascent Academia](https://ascentacademia.com.au/) that estimates VCE study scores and ATARs using only official VCAA and VTAC data.

- **Study score estimator**: enter SAC and exam percentages for any of 117 studies. It uses VCAA's statewide results for every graded assessment (mean, standard deviation, grade cut-offs and grade counts), the official weighting of each assessment and VCAA's published study score formula. It shows your grade on each assessment, your estimated study score with a likely range, and the exam score you need to reach a target.
- **ATAR calculator**: turns study scores into VTAC scaled scores, then builds the aggregate using VTAC's rules: English plus the best three in the primary four, 10% increments cut to 2 decimal places, grouping limits, equivalent studies, non-scored VET and higher education increments. The aggregate converts to an ATAR with VTAC's official aggregate-to-ATAR table.
- **Scaling explorer**: every study's scaled scores for 2021–2025, sortable, with the change from the previous year.

## Accuracy

| Step | Source | Check |
| --- | --- | --- |
| Scaled scores | VTAC Scaling Reports 2021–2025 (integers at study scores 20, 25, …, 50) | Monotone cubic (PCHIP) interpolation; mean absolute error 0.20 (max 0.53) against all 23 two-decimal scaled scores in VTAC's own worked examples |
| Aggregate → ATAR | VTAC aggregate-to-ATAR tables 2021–2025 (every 0.05 ATAR step) | Exact lookup; reproduces VTAC's worked examples (172.32 → 95.65, 136.17 → 80.30, 195.71 → 99.30, 103.36 → 57.15) |
| Study score | VCAA 2025 grade distributions (110 studies) + VCAA assessment summary weights | Implements VCAA's method; the joint spread of students' results across assessments is simulated (Gaussian copula, correlation 0.8, range 0.7–0.9) because VCAA doesn't publish it |

Limits: SAC results are moderated by VCAA, so enter your expected moderated SAC score. Future years' scaling, grade cut-offs and ATAR tables will differ slightly from the latest published year.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # engine tests (vitest)
npm run build      # static site in dist/
```

## Updating the data

Every figure in `src/data/` is generated from the official files:

```bash
npm run data:fetch   # downloads VTAC/VCAA PDFs and pages into data/raw/ (git-ignored)
npm run data:build   # parses them into src/data/studies.json and src/data/atar.json
```

To add a new year, add its VTAC report filenames to `scripts/sources.mjs` (and bump `GA_YEAR` when VCAA publishes new grade distributions, usually around April). The build script checks the parsed data: ATAR tables must be contiguous in 0.05 steps, scaling rows must be monotone, grade counts must add up and weights must total 100%.

Sources:
- VTAC scaling reports and aggregate-to-ATAR tables: https://vtac.edu.au/reports and https://vtac.edu.au/reports/archive
- VCAA grade distributions for graded assessments: https://www.vcaa.vic.edu.au/administration/school-administration/performance-senior-secondary
- VCAA assessment weightings: https://www.vcaa.vic.edu.au/administration/vce-administrative-handbook/vce-and-vet-assessment-summary
- VCAA study score method: https://www.vcaa.vic.edu.au/administration/vce-administrative-handbook/score-aggregation
- VTAC aggregate rules: https://vtac.edu.au/guides/atar-scaling-guide-2026.html

## Deployment

`.github/workflows/deploy.yml` runs the tests and publishes `dist/` to GitHub Pages on every push to `main`. Turn it on in the repository under **Settings → Pages → Source: GitHub Actions**.

This is an independent estimate and is not affiliated with VCAA or VTAC.
