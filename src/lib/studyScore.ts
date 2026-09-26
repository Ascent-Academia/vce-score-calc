// Study score estimation from graded assessment (GA) results.
//
// VCAA method (VCE Administrative Handbook, "Score aggregation"):
//   1. standardise each GA score: (score - state mean) / state SD
//   2. weight by the GA's contribution and add
//   3. rank the weighted totals of every student in the study
//   4. normalise the ranks (inverse normal) and rescale to mean 30, SD 7, truncated to 0–50.
//
// We have the official state mean, SD, grade cut-off scores and grade counts for every GA,
// but not the joint distribution of students' GA scores. We rebuild the cohort by Monte
// Carlo: each GA's marginal distribution is the official grade histogram (uniform within a
// grade's score range) and GAs are linked with a Gaussian copula with correlation rho.
// A student's percentile among the simulated weighted totals then gives their study score.
import type { GradedAssessment, Grade, Study } from './data';
import { cholesky, lowerBound, mulberry32, normalSampler, normCdf, normInv } from './stats';

/** Default inter-GA correlation and the range used for the uncertainty band. */
export const DEFAULT_RHO = 0.8;
export const RHO_RANGE: [number, number] = [0.7, 0.9];
const SAMPLES = 40000;

/** Continuous CDF of a GA's score from the grade histogram (each integer score spans ±0.5). */
export function gaCdf(ga: GradedAssessment, score: number): number {
  const total = ga.grades.reduce((s, g) => s + g.n, 0);
  if (total === 0) return 0.5;
  let below = 0;
  for (const g of ga.grades) {
    if (g.lo === null || g.hi === null || g.n === 0) continue;
    const lo = g.lo - 0.5;
    const hi = g.hi + 0.5;
    if (score >= hi) below += g.n;
    else if (score > lo) below += (g.n * (score - lo)) / (hi - lo);
  }
  return Math.min(1, Math.max(0, below / total));
}

/** Inverse of gaCdf. */
export function gaQuantile(ga: GradedAssessment, p: number): number {
  const total = ga.grades.reduce((s, g) => s + g.n, 0);
  let target = p * total;
  for (const g of ga.grades) {
    if (g.lo === null || g.hi === null || g.n === 0) continue;
    if (target <= g.n) {
      const lo = Math.max(0, g.lo - 0.5);
      const hi = Math.min(ga.max, g.hi + 0.5);
      return lo + (hi - lo) * (target / g.n);
    }
    target -= g.n;
  }
  return ga.max;
}

/** Grade for a GA score using VCAA's published score ranges. */
export function gradeFor(ga: GradedAssessment, score: number): Grade {
  const s = Math.round(score);
  let grade: Grade = 'UG';
  for (const g of ga.grades) if (g.lo !== null && s >= g.lo) grade = g.grade;
  return grade;
}

function correlation(gas: GradedAssessment[], rho: number): number[][] {
  // School-based GAs are statistically moderated against the external assessments,
  // so one correlation is used for every pair of GAs.
  return gas.map((_, i) => gas.map((__, j) => (i === j ? 1 : rho)));
}

const cache = new Map<string, Float64Array>();

/** Sorted weighted standardised totals for a simulated cohort of the study. */
export function simulatedTotals(study: Study, rho: number): Float64Array {
  const key = `${study.id}:${rho}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const gas = study.assessment!.gas;
  const L = cholesky(correlation(gas, rho));
  const rand = normalSampler(mulberry32(0x5eed ^ gas.length));
  const out = new Float64Array(SAMPLES);
  const e: number[] = Array.from({ length: gas.length }, () => 0);
  for (let s = 0; s < SAMPLES; s++) {
    for (let i = 0; i < gas.length; i++) e[i] = rand();
    let total = 0;
    for (let i = 0; i < gas.length; i++) {
      let v = 0;
      for (let k = 0; k <= i; k++) v += L[i][k] * e[k];
      const score = gaQuantile(gas[i], normCdf(v));
      total += ((score - gas[i].mean) / gas[i].sd) * (gas[i].weight / 100);
    }
    out[s] = total;
  }
  out.sort();
  cache.set(key, out);
  return out;
}

export function weightedTotal(study: Study, scores: number[]): number {
  return study.assessment!.gas.reduce((t, ga, i) => t + ((scores[i] - ga.mean) / ga.sd) * (ga.weight / 100), 0);
}

function percentileOf(sorted: Float64Array, x: number): number {
  const n = sorted.length;
  const i = lowerBound(sorted, x);
  if (i === 0) return 0.5 / n;
  if (i >= n) return 1 - 0.5 / n;
  // Linear interpolation between neighbouring simulated totals.
  const frac = (x - sorted[i - 1]) / (sorted[i] - sorted[i - 1] || 1);
  return (i - 0.5 + frac) / n;
}

export function percentileToStudyScore(p: number): number {
  return Math.max(0, Math.min(50, 30 + 7 * normInv(p)));
}

export interface GaResult {
  ga: GradedAssessment;
  score: number;
  grade: Grade;
  /** Share of students statewide scoring below this score. */
  percentile: number;
  z: number;
}

export interface StudyScoreEstimate {
  studyScore: number;
  /** Rounded like VCAA reports it. */
  rounded: number;
  low: number;
  high: number;
  percentile: number;
  gas: GaResult[];
}

/**
 * Estimates a study score from GA scores on the VCAA scale (0..ga.max each).
 * `rho` is the assumed correlation between GAs.
 */
export function estimateStudyScore(study: Study, scores: number[], rho = DEFAULT_RHO): StudyScoreEstimate {
  const gas = study.assessment!.gas;
  const clamped = scores.map((s, i) => Math.max(0, Math.min(gas[i].max, s)));
  const total = weightedTotal(study, clamped);
  const at = (r: number) => percentileToStudyScore(percentileOf(simulatedTotals(study, r), total));
  const p = percentileOf(simulatedTotals(study, rho), total);
  const ss = percentileToStudyScore(p);
  const a = at(RHO_RANGE[0]);
  const b = at(RHO_RANGE[1]);
  return {
    studyScore: ss,
    rounded: Math.round(ss),
    low: Math.min(a, b, ss),
    high: Math.max(a, b, ss),
    percentile: p,
    gas: gas.map((ga, i) => ({
      ga,
      score: clamped[i],
      grade: gradeFor(ga, clamped[i]),
      percentile: gaCdf(ga, clamped[i]),
      z: (clamped[i] - ga.mean) / ga.sd,
    })),
  };
}

/**
 * Score needed on GA `index` (VCAA scale) to reach a target study score, holding the
 * other GAs fixed. Returns null if unreachable even with full marks.
 */
export function requiredScore(study: Study, scores: number[], index: number, target: number, rho = DEFAULT_RHO): number | null {
  const ga = study.assessment!.gas[index];
  const f = (x: number) => {
    const s = scores.slice();
    s[index] = x;
    return estimateStudyScore(study, s, rho).studyScore;
  };
  if (f(ga.max) < target) return null;
  if (f(0) >= target) return 0;
  let lo = 0;
  let hi = ga.max;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}
