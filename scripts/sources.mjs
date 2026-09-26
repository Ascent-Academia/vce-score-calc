// Official source files used to build src/data/.

// VTAC reports by year. Scaling reports are released each December; older
// ones move to the reports archive (https://vtac.edu.au/reports/archive).
export const VTAC_FILES = {
  2021: { scaling: 'scaling-report-21-22.pdf', atar: 'atar-to-aggregate-21.pdf' },
  2022: { scaling: 'scaling-report-22-23.pdf', atar: 'atar-to-aggregate-22.pdf' },
  2023: { scaling: 'scaling-report-23-24.pdf', atar: 'atar-to-aggregate-23.pdf' },
  2024: { scaling: 'scaling-report-24.pdf', atar: 'atar-to-aggregate-24.pdf' },
  2025: { scaling: 'scaling-report-25.pdf', atar: 'atar-to-aggregate-25.pdf' },
};

// Year of VCAA graded assessment distributions (published each April for the previous year).
export const GA_YEAR = 2025;

// VCAA Senior Secondary Completion and Achievement Information (per-school median study
// score and % of study scores of 40+), averaged over these years for SAC moderation.
export const SSCAI_PAGE =
  'https://www.vcaa.vic.edu.au/administration/school-administration/performance-senior-secondary/senior-secondary-completion-and-achievement-information';
export const SSCAI_YEARS = [2023, 2024, 2025];
