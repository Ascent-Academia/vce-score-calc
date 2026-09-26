import { META, YEARS } from '../lib/data';
import { SCHOOL_SOURCE, SCHOOL_YEARS } from '../lib/moderation';

export function Methodology() {
  const s = META.sources;
  return (
    <section className="card prose">
      <h2>How the calculator works</h2>

      <h3>1. Study score (VCAA)</h3>
      <p>
        VCAA calculates study scores by standardising each graded assessment (GA) score against the state mean and standard deviation, weighting them by each GA's contribution
        (e.g. Mathematical Methods: SAC 40%, Exam 1 20%, Exam 2 40%), ranking every student's weighted total and converting the rank to a normal scale with mean 30 and standard deviation 7,
        truncated at 0 and 50.
      </p>
      <p>
        For each study the calculator uses VCAA's official {META.gaYear} numbers for every GA: the state mean, standard deviation, maximum score, the score range for each grade (UG to A+)
        and how many students got each grade. It then simulates 40,000 students whose results match those statewide numbers exactly, and ranks your weighted total against them. Grades
        shown next to each GA use the official {META.gaYear} grade cut-offs.
      </p>
      <p>
        <strong>What can't be known:</strong> VCAA doesn't publish how strongly students' results on different GAs move together. The model links them with a correlation of 0.8 and
        shows the range for 0.7–0.9. SAC scores are statistically moderated against each school's exam results, so enter your expected moderated SAC percentage. This year's exams and
        cut-offs will also differ slightly from {META.gaYear}.
      </p>

      <h3>SAC moderation (optional)</h3>
      <p>
        VCAA statistically moderates each school's SAC scores. It keeps the school's rank order but rescales the scores so their average and spread match the same
        students' exam results. The same rank is worth more at a school whose students do well on the exams.
      </p>
      <p>
        In <strong>My rank at school</strong> mode the calculator estimates this. Your rank (for example 3rd of 25) gives your position inside your school. The school's
        published VCAA results give how strong and how spread out its students are statewide: its median study score sets the level, and its percentage of study
        scores of 40+ sets the spread, averaged over {SCHOOL_YEARS[0]}–{SCHOOL_YEARS.at(-1)}. Together they give your statewide percentile, which is converted to a
        SAC score using VCAA's statewide SAC distribution. School-assessed tasks aren't statistically moderated, so they're left as entered.
      </p>
      <p>
        <strong>Limits:</strong> the school figures cover all subjects, not just the one you're estimating, and VCAA uses your classmates' actual exam results,
        which aren't known in advance. The range shown allows for a study's cohort sitting about 1.4 study score points above or below the school overall.
      </p>

      <h3>2. Scaling (VTAC)</h3>
      <p>
        VTAC publishes each study's scaled score at study scores of 20, 25, 30, 35, 40, 45 and 50, rounded to whole numbers. The calculator fits a monotone cubic curve (PCHIP) through
        those points and extends it in a straight line below 20. Tested against all 23 two-decimal scaled scores in VTAC's own worked examples (2021–2023), it is out by 0.20 on average
        and 0.53 at worst. Most of that comes from VTAC rounding the published points to whole numbers.
      </p>
      <p>Small language studies use the "All small LOTEs" row. For a study with no scaling in the selected year, the most recent earlier year is used and marked.</p>

      <h3>3. Aggregate and ATAR (VTAC)</h3>
      <ul>
        <li>Primary four: your best English study (English, EAL, English Language or Literature) plus your next three best scaled scores.</li>
        <li>Increments: 10% of your 5th and 6th scaled scores, cut to 2 decimal places the way VTAC does (10% of 36.86 counts as 3.68). Non-scored VCE VET/VE3 sequences add 10% of your 4th primary score; a higher education study adds 3.0–5.0.</li>
        <li>No more than two studies from one study area grouping (English, Mathematics, Languages, History, Music, IT, VET industry areas, …) in the primary four, and three overall.</li>
        <li>Only one of each set of equivalent studies counts (e.g. English and EAL; the same language at different levels).</li>
        <li>The calculator checks every allowed combination and keeps the one with the highest aggregate, as VTAC does.</li>
        <li>The aggregate converts to an ATAR with VTAC's official aggregate-to-ATAR table (every 0.05 ATAR step).</li>
      </ul>
      <p>
        Checks against VTAC's worked examples: the aggregates 172.32, 136.17, 195.71 and 103.36 give 95.65, 80.30, 99.30 and 57.15 under the 2023 table, the ATARs VTAC reports.
      </p>

      <h3>Official sources</h3>
      <ul>
        {YEARS.map((y) => (
          <li key={y}>
            VTAC {y}:{' '}
            <a href={s.scaling[y]} target="_blank" rel="noreferrer">
              Scaling Report
            </a>{' '}
            ·{' '}
            <a href={s.atar[y]} target="_blank" rel="noreferrer">
              Aggregate to ATAR table
            </a>
          </li>
        ))}
        <li>
          <a href={s.gradeDistributions} target="_blank" rel="noreferrer">
            VCAA {META.gaYear} grade distributions for VCE graded assessments
          </a>{' '}
          (one PDF per study)
        </li>
        <li>
          <a href={SCHOOL_SOURCE} target="_blank" rel="noreferrer">
            VCAA Senior Secondary Completion and Achievement Information
          </a>{' '}
          ({SCHOOL_YEARS.join(', ')}; per-school median study score and % of study scores 40+)
        </li>
        <li>
          <a href={s.weights} target="_blank" rel="noreferrer">
            VCAA VCE and VET assessment summary
          </a>{' '}
          (GA contributions to study scores)
        </li>
        <li>
          <a href="https://www.vcaa.vic.edu.au/administration/vce-administrative-handbook/score-aggregation" target="_blank" rel="noreferrer">
            VCAA score aggregation
          </a>{' '}
          and{' '}
          <a href="https://vtac.edu.au/guides/atar-scaling-guide-2026.html" target="_blank" rel="noreferrer">
            VTAC ATAR and Scaling Guide
          </a>{' '}
          (rules)
        </li>
      </ul>
      <p className="fineprint">
        Data generated {META.generated} from the files above with <code>npm run data:fetch && npm run data:build</code>. This is an estimate, not an official VTAC or VCAA result.
      </p>
    </section>
  );
}
