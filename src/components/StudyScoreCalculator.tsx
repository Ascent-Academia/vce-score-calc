import { useEffect, useMemo, useState } from 'react';
import { META, STUDIES, getStudy, scalingYearFor, type GradedAssessment, type Study } from '../lib/data';
import { DEFAULT_RHO, estimateStudyScore, gaCdf, gaQuantile, gradeFor, requiredFraction, studyScoreGain } from '../lib/studyScore';
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

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = store.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

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

/** Assessed outside the school (exams, externally-assessed tasks), not SACs or SATs. */
function isExternal(ga: GradedAssessment): boolean {
  return !isModerated(ga) && !/SCHOOL-ASSESSED/i.test(ga.title);
}

/** Compact assessment name for the results card, e.g. "Exam 2", "Unit 3 SACs", "SAT". */
function shortLabel(ga: GradedAssessment, all: GradedAssessment[]): string {
  if (ga.components) return 'Examination';
  const l = ga.label;
  let m = /^Units? (\d)(?: and (\d))? school-assessed coursework/i.exec(l);
  if (m) return all.filter(isModerated).length > 1 ? `Unit ${m[1]} SACs` : 'SACs';
  if (/school-assessed task/i.test(l)) return 'School-assessed task';
  m = /^Written examination (\d)$/i.exec(l);
  if (m) return `Exam ${m[1]}`;
  // A lone written exam is just "Exam" unless another exam (performance, oral…) sits beside it.
  if (/^Written examination$/i.test(l)) return all.filter((g) => isExternal(g)).length > 1 ? 'Written exam' : 'Exam';
  return cap(l.replace(/examination/i, 'exam'));
}

/** "+1.4", "−0.3", "0.0" */
const signed = (x: number, dp: number) => {
  const r = Number(x.toFixed(dp));
  return r > 0 ? `+${r.toFixed(dp)}` : r < 0 ? `−${Math.abs(r).toFixed(dp)}` : (0).toFixed(dp);
};

/** Where a percentile sits, phrased for students. */
function standing(p: number): string {
  if (p >= 0.5) return `top ${pct(1 - p)} of the state`;
  return `above ${pct(p)} of students`;
}

/** Required share of full marks, rounded up so it's never optimistic. */
const pctNeed = (p: number) => `${Math.min(100, Math.ceil(p * 100 - 1e-6))}%`;
const pct = (x: number) => `${(x * 100).toFixed(x > 0.995 || x < 0.005 ? 1 : 0)}%`;

export function StudyScoreCalculator({ year, studyId, setStudyId, onUse, useLabel }: Props) {
  const study = (studyId && getStudy(studyId)?.assessment ? getStudy(studyId) : null) as Study | null;
  const [inputs, setInputs] = useState<Inputs>(() => loadJson('studyInputs', {}));
  const [rho, setRho] = useState(DEFAULT_RHO);
  const [targetInput, setTarget] = useState<string | null>(null);
  const [sacMode, setSacModeState] = useState<SacMode>(() => (store.get('sacMode') === 'rank' ? 'rank' : 'score'));
  const [school, setSchoolState] = useState<string | null>(() => store.get('school'));
  const [ranks, setRanks] = useState<Ranks>(() => loadJson('sacRanks', {}));
  const [averages, setAverages] = useState<ClassAverages>(() => loadJson('sacAverages', {}));
  const [classSd, setClassSd] = useState(() => store.get('classSd') ?? String(DEFAULT_CLASS_SD));

  // Keep each study's entries when switching tabs or reloading.
  useEffect(() => store.set('studyInputs', JSON.stringify(inputs)), [inputs]);
  useEffect(() => store.set('sacRanks', JSON.stringify(ranks)), [ranks]);
  useEffect(() => store.set('sacAverages', JSON.stringify(averages)), [averages]);
  useEffect(() => store.set('classSd', classSd), [classSd]);
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
          // Until the school and a class average (or rank) are set, use the SAC % as entered
          // so the estimate never goes blank.
          return { ga, values: v, start, raw, mod, basis, pending: !mod, score: mod ? mod.score : raw };
        }
        return { ga, values: v, start, raw, mod: null, basis: null, pending: false, score: raw };
      })
    : [];
  const complete = perGa.length > 0 && perGa.every((g) => g.score !== null);
  const pendingCount = perGa.filter((g) => g.pending).length;
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

  // Until the user picks a target, suggest five above the current estimate.
  const target = targetInput ?? (estimate ? String(Math.min(50, estimate.rounded + 5)) : '40');
  const t = Number(target);
  const targetValid = t >= 1 && t <= 50;
  const scoresKey = JSON.stringify(scores);

  // How much 5 more percentage points on each GA would lift the study score.
  const leverage = useMemo(() => {
    if (!study || !complete) return [];
    return perGa.map((_, i) => studyScoreGain(study, scores, i, 5, rho));
  }, [study, complete, scoresKey, rho]); // eslint-disable-line react-hooks/exhaustive-deps

  // What each GA (or every external assessment together) needs for the target.
  const routes = useMemo(() => {
    if (!study || !complete || !targetValid) return [];
    const gas = study.assessment!.gas;
    const out: { key: string; label: string; indices: number[]; p: number | null }[] = gas.map((ga, i) => ({
      key: String(ga.ga),
      label: shortLabel(ga, gas),
      indices: [i],
      p: requiredFraction(study, scores, [i], t, rho),
    }));
    const external = gas.map((ga, i) => (isExternal(ga) ? i : -1)).filter((i) => i >= 0);
    if (external.length >= 2) {
      const allExams = external.every((i) => /EXAM|TEST/i.test(gas[i].title));
      out.push({
        key: 'external',
        label: allExams ? (external.length === 2 ? 'Both exams, same %' : `All ${external.length} exams, same %`) : 'All external assessments, same %',
        indices: external,
        p: requiredFraction(study, scores, external, t, rho),
      });
    }
    return out;
  }, [study, complete, scoresKey, t, targetValid, rho]); // eslint-disable-line react-hooks/exhaustive-deps

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
            {perGa.map(({ ga, values: v, start, score, raw, mod, basis, pending }) => (
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
                        ) : pending ? (
                          <small className="muted">
                            {score.toFixed(ga.max >= 100 ? 0 : 1)}/{ga.max} as entered ·{' '}
                            <span className="pending">{strength ? 'add the class average (or your rank above) to adjust for your school' : 'pick your school above to adjust it'}</span>
                          </small>
                        ) : (
                          <small className="muted">
                            {score.toFixed(ga.max >= 100 ? 0 : 1)}/{ga.max} · above {pct(gaCdf(ga, score))} of {ga.n.toLocaleString()} students
                          </small>
                        )}
                      </>
                    ) : (
                      <small className="muted">
                        {moderating && isModerated(ga) ? 'Enter your SAC % (and class average to adjust it)' : 'Enter a percentage'}
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
        {estimate && study && (
          <>
            <p className="muted">
              Likely range {Math.floor(estimate.low)}–{Math.ceil(estimate.high)} · {standing(estimate.percentile)}
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
              <div>
                <dt>Scaling</dt>
                <dd className={scaled == null ? '' : scaled - estimate.rounded >= 0.005 ? 'up' : scaled - estimate.rounded <= -0.005 ? 'down' : ''}>
                  {scaled != null ? signed(scaled - estimate.rounded, 2) : '–'}
                </dd>
              </div>
            </dl>
            <button type="button" className="glass-btn prominent block" onClick={() => onUse(study.id, estimate.rounded)}>
              {useLabel}
            </button>

            <section className="result-section">
              <h3>What moves your score</h3>
              <p className="muted small">Study score change from 5 more percentage points on each assessment, the others unchanged.</p>
              <ul className="ga-rows">
                {perGa.map((g, i) => {
                  const gain = leverage[i] ?? 0;
                  const best = leverage.length > 1 && gain > 0.05 && gain === Math.max(...leverage);
                  return (
                    <li key={g.ga.ga} className={best ? 'best' : ''}>
                      <span className="ga-name">
                        {shortLabel(g.ga, study.assessment!.gas)} <span className="weight">{g.ga.weight}%</span>
                      </span>
                      <span className={`grade g-${gradeFor(g.ga, g.score ?? 0).replace('+', 'p')}`}>{gradeFor(g.ga, g.score ?? 0)}</span>
                      <span className="ga-val">{g.score !== null && g.score >= g.ga.max - 1e-9 ? 'Full marks' : `${signed(gain, 1)}`}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="result-section">
              <div className="target-label">
                <h3 id="target-heading">To reach a study score of</h3>
                <input type="number" min={1} max={50} value={target} onChange={(e) => setTarget(e.target.value)} aria-labelledby="target-heading" />
              </div>
              {!targetValid ? (
                <p className="hint">Enter a target between 1 and 50.</p>
              ) : (
                <>
                  <ul className="ga-rows">
                    {routes.map((r) => {
                      const ga = study.assessment!.gas[r.indices[0]];
                      const single = r.indices.length === 1;
                      const moderatedRow = single && moderating && isModerated(ga);
                      return (
                        <li key={r.key} className={r.indices.length > 1 ? 'combo' : ''}>
                          <span className="ga-name">{r.label}</span>
                          {r.p === null ? (
                            <span className="ga-val out">Out of reach</span>
                          ) : r.p === 0 ? (
                            <span className="ga-val ok">Any score</span>
                          ) : (
                            <>
                              {single && <span className={`grade g-${gradeFor(ga, r.p * ga.max).replace('+', 'p')}`}>{gradeFor(ga, r.p * ga.max)}</span>}
                              <span className="ga-val">
                                {pctNeed(r.p)}
                                {moderatedRow && <small> moderated</small>}
                              </span>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="muted small">
                    {routes.length > perGa.length
                      ? 'Each row changes only that assessment (the last row raises them together), keeping your other results as entered.'
                      : 'Each row changes only that assessment, keeping your other results as entered.'}
                    {routes.some((r) => r.p === null) &&
                      ` "Out of reach" means full marks there isn't enough on its own.`}
                  </p>
                </>
              )}
            </section>
          </>
        )}
        {estimate && pendingCount > 0 && (
          <p className="hint pending-note">
            {pendingCount === 1 ? '1 SAC isn\'t' : `${pendingCount} SACs aren't`} adjusted for your school yet, so {pendingCount === 1 ? 'it uses' : 'they use'} your SAC % as entered.
            {strength ? ' Add the class average (or your rank) to adjust.' : ' Pick your school to adjust.'}
          </p>
        )}
        <p className="fineprint">
          {!hasSacs
            ? `Estimated from VCAA's ${META.gaYear} statewide results for each assessment. Grade cut-offs and the spread of results change a little each year, so treat it as a guide.`
            : moderating
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
