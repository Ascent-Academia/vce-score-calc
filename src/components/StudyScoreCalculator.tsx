import { useEffect, useMemo, useState } from 'react';
import { META, STUDIES, getStudy, scalingYearFor, type GradedAssessment, type Study } from '../lib/data';
import { DEFAULT_RHO, estimateStudyScore, gaCdf, gaQuantile, gradeFor, requiredScore } from '../lib/studyScore';
import { scaledScore } from '../lib/scaling';
import { StudyPicker } from './StudyPicker';

const MODELLED = STUDIES.filter((s) => s.assessment);

interface Props {
  year: number;
  studyId: string | null;
  setStudyId: (id: string) => void;
  onUse: (studyId: string, studyScore: number) => void;
  useLabel: string;
}

type Inputs = Record<string, string[]>;

/** Percentage inputs per GA; Languages exams take separate oral and written percentages. */
function gaInputs(ga: GradedAssessment) {
  return ga.components ?? [{ title: ga.label, weight: ga.weight }];
}

function toGaScore(ga: GradedAssessment, values: string[]): number | null {
  const comps = gaInputs(ga);
  let pct = 0;
  let w = 0;
  for (let k = 0; k < comps.length; k++) {
    if (values[k] === '' || values[k] == null) return null;
    pct += Number(values[k]) * comps[k].weight;
    w += comps[k].weight;
  }
  return (Math.max(0, Math.min(100, pct / w)) / 100) * ga.max;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (x: number) => `${(x * 100).toFixed(x > 0.995 || x < 0.005 ? 1 : 0)}%`;

export function StudyScoreCalculator({ year, studyId, setStudyId, onUse, useLabel }: Props) {
  const study = (studyId && getStudy(studyId)?.assessment ? getStudy(studyId) : null) as Study | null;
  const [inputs, setInputs] = useState<Inputs>({});
  const [rho, setRho] = useState(DEFAULT_RHO);
  const [targetInput, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (study && !inputs[study.id]) {
      // Start from the state median for each GA.
      setInputs((prev) => ({
        ...prev,
        [study.id]: study.assessment!.gas.flatMap((ga) => gaInputs(ga).map(() => String(Math.round((gaQuantile(ga, 0.5) / ga.max) * 100)))),
      }));
    }
  }, [study, inputs]);

  const values = study ? (inputs[study.id] ?? []) : [];
  let offset = 0;
  const perGa = study
    ? study.assessment!.gas.map((ga) => {
        const n = gaInputs(ga).length;
        const v = values.slice(offset, offset + n);
        const start = offset;
        offset += n;
        return { ga, values: v, start, score: toGaScore(ga, v) };
      })
    : [];
  const complete = perGa.length > 0 && perGa.every((g) => g.score !== null);
  const scores = perGa.map((g) => g.score ?? 0);
  const estimate = useMemo(() => (study && complete ? estimateStudyScore(study, scores, rho) : null), [study, complete, JSON.stringify(scores), rho]); // eslint-disable-line react-hooks/exhaustive-deps

  const sy = study ? scalingYearFor(study, year) : null;
  const scaled = estimate && sy ? scaledScore(study!, estimate.rounded, sy) : null;

  const lastIdx = perGa.length - 1;
  // Until the user picks a target, suggest five above the current estimate.
  const target = targetInput ?? (estimate ? String(Math.min(50, estimate.rounded + 5)) : '40');
  const t = Number(target);
  const need = useMemo(() => {
    if (!study || !complete || !(t > 0 && t <= 50)) return undefined;
    return requiredScore(study, scores, lastIdx, t, rho);
  }, [study, complete, JSON.stringify(scores), lastIdx, t, rho]); // eslint-disable-line react-hooks/exhaustive-deps

  const setValue = (i: number, v: string) => {
    if (!study) return;
    const next = values.slice();
    next[i] = v;
    setInputs({ ...inputs, [study.id]: next });
  };

  return (
    <div className="grid-2">
      <section className="card">
        <header className="card-head">
          <h2>Study score estimator</h2>
          <p className="muted">Uses VCAA's {META.gaYear} statewide results for every graded assessment (GA) and the official study score formula.</p>
        </header>
        <label className="block">
          Study
          <StudyPicker label="Study for estimate" studies={MODELLED} value={study?.id ?? null} onChange={setStudyId} placeholder="Choose a study…" />
        </label>

        {study && (
          <div className="ga-list">
            {perGa.map(({ ga, values: v, start, score }) => (
              <fieldset key={ga.ga} className="ga">
                <legend>
                  GA{ga.ga}: {ga.components ? 'Examination (oral + written)' : ga.label} <span className="weight">{ga.weight}%</span>
                </legend>
                <div className="ga-inputs">
                  {gaInputs(ga).map((c, k) => (
                    <label key={k}>
                      {gaInputs(ga).length > 1 ? `${cap(c.title.replace(/^Examination: | component$/g, ''))} (${c.weight}%)` : 'Your score'}
                      <span className="pct-input">
                        <input type="number" min={0} max={100} step="any" value={v[k] ?? ''} onChange={(e) => setValue(start + k, e.target.value)} />
                        <span>%</span>
                      </span>
                    </label>
                  ))}
                  <div className="ga-out">
                    {score !== null ? (
                      <>
                        <span className={`grade g-${gradeFor(ga, score).replace('+', 'p')}`}>{gradeFor(ga, score)}</span>
                        <small className="muted">
                          {score.toFixed(ga.max >= 100 ? 0 : 1)}/{ga.max} · above {pct(gaCdf(ga, score))} of {ga.n.toLocaleString()} students
                        </small>
                      </>
                    ) : (
                      <small className="muted">Enter a percentage</small>
                    )}
                  </div>
                </div>
                <GradeBar ga={ga} score={score} />
              </fieldset>
            ))}
          </div>
        )}
        {study && (
          <details className="extras">
            <summary>Model settings</summary>
            <label className="block">
              Correlation between GAs: <strong>{rho.toFixed(2)}</strong>
              <input type="range" min={0.5} max={0.95} step={0.05} value={rho} onChange={(e) => setRho(Number(e.target.value))} />
              <small className="muted">
                VCAA doesn't publish how students' SAC and exam results correlate. 0.8 is the default; the range shown uses 0.7–0.9. Lower values reward consistent students more.
              </small>
            </label>
          </details>
        )}
      </section>

      <aside className="card result" aria-live="polite">
        <p className="eyebrow">Estimated study score{study ? ` · ${study.name}` : ''}</p>
        <p className="atar">{estimate ? estimate.rounded : '—'}</p>
        {estimate && (
          <>
            <p className="muted">
              Likely range {Math.floor(estimate.low)}–{Math.ceil(estimate.high)} · top {pct(1 - estimate.percentile)} of the state
            </p>
            <dl className="stats">
              <div>
                <dt>Unrounded</dt>
                <dd>{estimate.studyScore.toFixed(1)}</dd>
              </div>
              <div>
                <dt>Scaled ({sy ?? '–'})</dt>
                <dd>{scaled != null ? scaled.toFixed(2) : '–'}</dd>
              </div>
            </dl>
            <button type="button" className="primary" onClick={() => onUse(study!.id, estimate.rounded)}>
              {useLabel}
            </button>
            <div className="target">
              <label>
                What do I need on <strong>{perGa[lastIdx].ga.components ? 'the examination' : perGa[lastIdx].ga.label.toLowerCase()}</strong> for a study score of
                <input type="number" min={1} max={50} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target study score" />?
              </label>
              <p className="hint">
                {need === undefined
                  ? 'Enter a target between 1 and 50.'
                  : need === null
                    ? `Not reachable with your other results: full marks gives about ${Math.floor(estimateStudyScore(study!, scores.map((v, i) => (i === lastIdx ? perGa[i].ga.max : v)), rho).studyScore)}.`
                    : `About ${((need / perGa[lastIdx].ga.max) * 100).toFixed(0)}% (${need.toFixed(0)}/${perGa[lastIdx].ga.max}, grade ${gradeFor(perGa[lastIdx].ga, need)}), keeping your other GA results as entered.`}
              </p>
            </div>
          </>
        )}
        <p className="fineprint">
          Enter SAC results as your expected <em>moderated</em> score: VCAA rescales each school's SAC scores to match how that school's students do on the exam, so your raw school percentage can move up or down.
        </p>
      </aside>
    </div>
  );
}

function GradeBar({ ga, score }: { ga: GradedAssessment; score: number | null }) {
  const total = ga.grades.reduce((s, g) => s + g.n, 0) || 1;
  const bands = ga.grades.filter((g) => g.lo !== null);
  return (
    <div className="gradebar" aria-hidden="true">
      <div className="gradebar-track">
        {bands.map((g) => (
          <div key={g.grade} className="gradebar-seg" style={{ width: `${((g.hi! - g.lo! + 1) / (ga.max + 1)) * 100}%` }} title={`${g.grade}: ${g.lo}–${g.hi} (${((g.n / total) * 100).toFixed(1)}% of students)`}>
            <span>{g.grade}</span>
          </div>
        ))}
        {score !== null && <div className="gradebar-mark" style={{ left: `${(score / ga.max) * 100}%` }} />}
      </div>
    </div>
  );
}
