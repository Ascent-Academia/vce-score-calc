import { useEffect, useMemo, useState } from 'react';
import { META, STUDIES, getStudy, scalingYearFor, type GradedAssessment, type Study } from '../lib/data';
import { DEFAULT_RHO, estimateStudyScore, gaCdf, gaQuantile, gradeFor, requiredScore } from '../lib/studyScore';
import { scaledScore } from '../lib/scaling';
import { StudyPicker } from './StudyPicker';
import { SchoolPicker } from './SchoolPicker';
import { DEFAULT_CLASS_SD, SCHOOL_YEARS, findSchool, isModerated, moderatedSac, moderatedSacFromZ, presetStrength, schoolStrength, withinSchoolZFromScore, type ModeratedSac, type SchoolStrength } from '../lib/moderation';

const MODELLED = STUDIES.filter((s) => s.assessment);

interface Props {
  year: number;
  studyId: string | null;
  setStudyId: (id: string) => void;
  onUse: (studyId: string, studyScore: number) => void;
  useLabel: string;
}

type Inputs = Record<string, string[]>;
type SacMode = 'score' | 'rank';
type Ranks = Record<string, { rank: string; cohort: string }>;
/** Class average % per study, keyed by GA number. */
type ClassAverages = Record<string, Record<number, string>>;
type ModBasis = { kind: 'average'; avg: number } | { kind: 'rank' };

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`vce-score-calc:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(`vce-score-calc:${key}`);
      else localStorage.setItem(`vce-score-calc:${key}`, value);
    } catch {
      /* storage unavailable */
    }
  },
};

function strengthFor(key: string | null): SchoolStrength | null {
  if (!key) return null;
  const preset = presetStrength(key);
  if (preset) return preset;
  const school = findSchool(key);
  return school ? schoolStrength(school) : null;
}

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

/** "raw 85% ↓" comparing rounded percentages, so equal-looking numbers don't show an arrow. */
function rawVsModerated(raw: number, moderated: number, max: number): string {
  const r = Math.round((raw / max) * 100);
  const m = Math.round((moderated / max) * 100);
  return `raw ${r}%${m > r ? ' ↑' : m < r ? ' ↓' : ''}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (x: number) => `${(x * 100).toFixed(x > 0.995 || x < 0.005 ? 1 : 0)}%`;

export function StudyScoreCalculator({ year, studyId, setStudyId, onUse, useLabel }: Props) {
  const study = (studyId && getStudy(studyId)?.assessment ? getStudy(studyId) : null) as Study | null;
  const [inputs, setInputs] = useState<Inputs>({});
  const [rho, setRho] = useState(DEFAULT_RHO);
  const [targetInput, setTarget] = useState<string | null>(null);
  const [sacMode, setSacModeState] = useState<SacMode>(() => (store.get('sacMode') === 'rank' ? 'rank' : 'score'));
  const [school, setSchoolState] = useState<string | null>(() => store.get('school'));
  const [ranks, setRanks] = useState<Ranks>({});
  const [averages, setAverages] = useState<ClassAverages>({});
  const [classSd, setClassSd] = useState(String(DEFAULT_CLASS_SD));
  const setSacMode = (m: SacMode) => {
    setSacModeState(m);
    store.set('sacMode', m);
  };
  const setSchool = (k: string) => {
    setSchoolState(k);
    store.set('school', k);
  };

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
  const hasSacs = !!study?.assessment!.gas.some(isModerated);
  const moderating = hasSacs && sacMode === 'rank';
  const strength = strengthFor(school);
  const rankInput = (study && ranks[study.id]) || { rank: '', cohort: '25' };
  const rankN = Number(rankInput.rank);
  const cohortN = Number(rankInput.cohort);
  const rankValid = Number.isInteger(rankN) && Number.isInteger(cohortN) && cohortN >= 2 && rankN >= 1 && rankN <= cohortN;
  const setRank = (patch: Partial<{ rank: string; cohort: string }>) => study && setRanks({ ...ranks, [study.id]: { ...rankInput, ...patch } });
  const studyAverages = (study && averages[study.id]) || {};
  const setAverage = (ga: number, v: string) => study && setAverages({ ...averages, [study.id]: { ...studyAverages, [ga]: v } });
  const sdN = Number(classSd) > 0 ? Number(classSd) : DEFAULT_CLASS_SD;

  let offset = 0;
  const perGa = study
    ? study.assessment!.gas.map((ga) => {
        const n = gaInputs(ga).length;
        const v = values.slice(offset, offset + n);
        const start = offset;
        offset += n;
        const raw = toGaScore(ga, v);
        if (moderating && isModerated(ga)) {
          // Prefer your SAC % against the class average (VCAA's linear rescale); fall back to rank.
          const avgText = studyAverages[ga.ga] ?? '';
          const avg = avgText === '' ? NaN : Number(avgText);
          let mod: ModeratedSac | null = null;
          let basis: ModBasis | null = null;
          if (strength && raw !== null && Number.isFinite(avg)) {
            mod = moderatedSacFromZ(ga, withinSchoolZFromScore((raw / ga.max) * 100, avg, sdN), strength);
            basis = { kind: 'average', avg };
          } else if (strength && rankValid) {
            mod = moderatedSac(ga, rankN, cohortN, strength);
            basis = { kind: 'rank' };
          }
          return { ga, values: v, start, raw, mod, basis, score: mod ? mod.score : null };
        }
        return { ga, values: v, start, raw, mod: null, basis: null, score: raw };
      })
    : [];
  const complete = perGa.length > 0 && perGa.every((g) => g.score !== null);
  const scores = perGa.map((g) => g.score ?? 0);
  const estimate = useMemo(() => {
    if (!study || !complete) return null;
    const e = estimateStudyScore(study, scores, rho);
    if (!moderating) return e;
    // Widen the range for the uncertainty in how this study's cohort compares with the whole school.
    const lo = estimateStudyScore(study, perGa.map((g) => g.mod?.low ?? g.score ?? 0), rho);
    const hi = estimateStudyScore(study, perGa.map((g) => g.mod?.high ?? g.score ?? 0), rho);
    return { ...e, low: Math.min(e.low, lo.low, lo.studyScore), high: Math.max(e.high, hi.high, hi.studyScore) };
  }, [study, complete, JSON.stringify(scores), JSON.stringify(perGa.map((g) => g.mod)), rho, moderating]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {study && hasSacs && (
          <fieldset className="moderation">
            <legend>School-assessed coursework (SACs)</legend>
            <div className="segmented" role="radiogroup" aria-label="How to enter SACs">
              <button type="button" role="radio" aria-checked={sacMode === 'score'} className={sacMode === 'score' ? 'on' : ''} onClick={() => setSacMode('score')}>
                My SAC %
              </button>
              <button type="button" role="radio" aria-checked={sacMode === 'rank'} className={sacMode === 'rank' ? 'on' : ''} onClick={() => setSacMode('rank')}>
                Adjust for my school
              </button>
            </div>
            {sacMode === 'score' ? (
              <p className="muted small">
                Your SAC percentage is used as entered. VCAA moderates SACs against each school's exam results, so switch to <strong>Adjust for my school</strong> for an estimate of your moderated SAC score.
              </p>
            ) : (
              <>
                <div className="moderation-grid">
                  <label className="school-field">
                    School
                    <SchoolPicker value={school} onChange={setSchool} />
                  </label>
                  <label>
                    Class spread
                    <span className="rank-input">
                      <input type="number" min={1} max={40} value={classSd} onChange={(e) => setClassSd(e.target.value)} aria-label="Class spread (standard deviation, percentage points)" />
                      <span>% SD</span>
                    </span>
                  </label>
                </div>
                <p className="muted small">
                  {strength
                    ? `${findSchool(school ?? '') ? `${SCHOOL_YEARS[0]}–${String(SCHOOL_YEARS.at(-1)).slice(2)} VCAA results: ` : ''}median study score ${strength.median.toFixed(1)}${strength.p40 !== null ? `, ${strength.p40.toFixed(1)}% of study scores 40+` : ''}. `
                    : "Pick your school (or a rough level if it isn't listed). "}
                  For each SAC below, enter <strong>your %</strong> and your <strong>class average %</strong>. VCAA keeps how far above or below the average you are
                  (measured against the class spread, typically 10–15%) and rescales it to your school's exam results.
                </p>
                <details className="rank-fallback">
                  <summary>Don't know the class average? Use your rank instead</summary>
                  <label>
                    SAC rank in {study.name}
                    <span className="rank-input">
                      <input type="number" min={1} value={rankInput.rank} placeholder="e.g. 3" onChange={(e) => setRank({ rank: e.target.value })} aria-label="Your SAC rank" />
                      <span>of</span>
                      <input type="number" min={2} value={rankInput.cohort} onChange={(e) => setRank({ cohort: e.target.value })} aria-label="Students in this study at your school" />
                    </span>
                  </label>
                  <small className="muted">Used for any SAC without a class average (1 = top of the cohort).</small>
                </details>
              </>
            )}
          </fieldset>
        )}

        {study && (
          <div className="ga-list">
            {perGa.map(({ ga, values: v, start, score, raw, mod, basis }) => (
              <fieldset key={ga.ga} className="ga">
                <legend>
                  GA{ga.ga}: {ga.components ? 'Examination (oral + written)' : ga.label} <span className="weight">{ga.weight}%</span>
                </legend>
                <div className="ga-inputs">
                  {gaInputs(ga).map((c, k) => (
                    <label key={k}>
                      {gaInputs(ga).length > 1
                        ? `${cap(c.title.replace(/^Examination: | component$/g, ''))} (${c.weight}%)`
                        : moderating && isModerated(ga)
                          ? 'Your SAC %'
                          : 'Your score'}
                      <span className="pct-input">
                        <input type="number" min={0} max={100} step="any" value={v[k] ?? ''} onChange={(e) => setValue(start + k, e.target.value)} />
                        <span>%</span>
                      </span>
                    </label>
                  ))}
                  {moderating && isModerated(ga) && (
                    <label>
                      Class average
                      <span className="pct-input">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="any"
                          placeholder="e.g. 72"
                          value={studyAverages[ga.ga] ?? ''}
                          onChange={(e) => setAverage(ga.ga, e.target.value)}
                          aria-label={`Class average for GA${ga.ga}`}
                        />
                        <span>%</span>
                      </span>
                    </label>
                  )}
                  <div className="ga-out">
                    {score !== null ? (
                      <>
                        <span className={`grade g-${gradeFor(ga, score).replace('+', 'p')}`}>{gradeFor(ga, score)}</span>
                        {mod ? (
                          <small className="muted">
                            <strong className="moderated">≈ {((score / ga.max) * 100).toFixed(0)}% after moderation</strong> ({((mod.low / ga.max) * 100).toFixed(0)}–{((mod.high / ga.max) * 100).toFixed(0)}%)
                            {basis?.kind === 'average' && raw !== null
                              ? ` · ${(Math.abs(mod.zWithin) < 0.05 ? 'at' : `${Math.abs((raw / ga.max) * 100 - basis.avg).toFixed(0)} points ${mod.zWithin > 0 ? 'above' : 'below'}`)} the class average · ${rawVsModerated(raw, score, ga.max)}`
                              : ` · from rank ${rankN} of ${cohortN}${raw !== null ? ` · ${rawVsModerated(raw, score, ga.max)}` : ''}`}
                            {' '}· above {pct(gaCdf(ga, score))} of students
                          </small>
                        ) : (
                          <small className="muted">
                            {score.toFixed(ga.max >= 100 ? 0 : 1)}/{ga.max} · above {pct(gaCdf(ga, score))} of {ga.n.toLocaleString()} students
                          </small>
                        )}
                      </>
                    ) : (
                      <small className="muted">
                        {moderating && isModerated(ga) ? (strength ? 'Enter your SAC % and class average (or your rank above)' : 'Pick your school above') : 'Enter a percentage'}
                      </small>
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

      <aside className="card result glass" aria-live="polite">
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
            <button type="button" className="glass-btn prominent block" onClick={() => onUse(study!.id, estimate.rounded)}>
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
          {moderating
            ? "Moderated SACs are estimated from your position in your class and your school's published VCAA results. Your class's actual exam results, which VCAA uses, aren't known in advance, so treat them as a range."
            : "VCAA rescales each school's SAC scores to match how that school's students do on the exam, so your raw school percentage can move up or down. Use \"Adjust for my school\" to estimate it."}
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
