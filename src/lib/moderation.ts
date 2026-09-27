// Approximate VCAA statistical moderation of school-assessed coursework (SACs).
//
// VCAA rescales each school's SAC scores in a study so their level and spread match
// the same students' external (exam) scores. Rank order within the school is kept.
// A student's moderated SAC therefore depends on
//   1. their SAC rank within the school's cohort for the study, and
//   2. how strong and how spread out that cohort is on the exams.
//
// We estimate (2) from VCAA's Senior Secondary Completion and Achievement Information:
// each school's median study score (level) and % of study scores of 40+ (spread),
// averaged over several years. Study scores are on a mean 30 / SD 7 normal scale, so
//   school mean (z)  ≈ (median − 30) / 7
//   school SD  (z)   ≈ (39.5 − median) / Φ⁻¹(1 − p40) / 7
// The student's statewide position is  z = mean + SD · z_within, and the moderated SAC
// is the statewide SAC score at that percentile. z_within comes from the SAC score
// relative to the class average (VCAA's own linear rescale), or from rank if that's
// all the student knows.
import schoolsJson from '../data/schools.json';
import type { GradedAssessment, Study } from './data';
import { gaQuantile } from './studyScore';
import { normCdf, normInv } from './stats';

export interface SchoolRecord {
  name: string;
  locality: string;
  /** Year -> [median study score, % of study scores 40+, VCE students]. */
  years: Record<string, [number, number | null, number | null]>;
}

export interface SchoolStrength {
  /** Mean of the school's results on the statewide z scale. */
  mean: number;
  /** Spread of the school's results on the statewide z scale. */
  sd: number;
  median: number;
  p40: number | null;
}

const data = schoolsJson as unknown as { source: string; years: number[]; schools: SchoolRecord[] };
export const SCHOOLS: SchoolRecord[] = data.schools;
export const SCHOOL_SOURCE = data.source;
export const SCHOOL_YEARS = data.years;

/** Typical within-school spread when % 40+ can't pin it down (VCE-wide average ≈ 0.9). */
const DEFAULT_SD = 0.9;
const SD_RANGE: [number, number] = [0.6, 1.2];
/** A study's cohort at a school can sit above or below the school overall; used for the range. */
export const SUBJECT_UNCERTAINTY = 0.2;

/** Rough levels for schools that aren't in the list (median study score). */
export const SCHOOL_PRESETS = [
  { id: 'preset-26', label: 'Below average (median ≈ 26)', median: 26 },
  { id: 'preset-29', label: 'About average (median ≈ 29)', median: 29 },
  { id: 'preset-31', label: 'Above average (median ≈ 31)', median: 31 },
  { id: 'preset-33', label: 'Strong (median ≈ 33)', median: 33 },
  { id: 'preset-36', label: 'Selective / top (median ≈ 36)', median: 36 },
] as const;

export function strengthFrom(median: number, p40Percent: number | null): SchoolStrength {
  const mean = (median - 30) / 7;
  let sd = DEFAULT_SD;
  if (p40Percent !== null) {
    const p = p40Percent / 100;
    // Only informative when the 40+ share is neither ~0 nor ~all and 40 is above the median.
    if (p > 0.005 && p < 0.5 && median < 39.5) {
      sd = (39.5 - median) / normInv(1 - p) / 7;
    }
  }
  sd = Math.min(SD_RANGE[1], Math.max(SD_RANGE[0], sd));
  return { mean, sd, median, p40: p40Percent };
}

/** Student-weighted average of a school's published figures across years. */
export function schoolStrength(school: SchoolRecord): SchoolStrength {
  let w = 0;
  let median = 0;
  let p40w = 0;
  let p40 = 0;
  for (const [m, p, n] of Object.values(school.years)) {
    const weight = n ?? 1;
    median += m * weight;
    w += weight;
    if (p !== null) {
      p40 += p * weight;
      p40w += weight;
    }
  }
  return strengthFrom(median / w, p40w ? p40 / p40w : null);
}

export function presetStrength(id: string): SchoolStrength | null {
  const preset = SCHOOL_PRESETS.find((p) => p.id === id);
  return preset ? strengthFrom(preset.median, null) : null;
}

export function schoolKey(s: SchoolRecord): string {
  return `${s.name}|${s.locality}`;
}

export function findSchool(key: string): SchoolRecord | undefined {
  return SCHOOLS.find((s) => schoolKey(s) === key);
}

/** Coursework GAs are statistically moderated; school-assessed tasks are reviewed instead. */
export function isModerated(ga: GradedAssessment): boolean {
  return /COURSEWORK/i.test(ga.title);
}

export function moderatedGas(study: Study): GradedAssessment[] {
  return study.assessment?.gas.filter(isModerated) ?? [];
}

/** Position within the school cohort (rank 1 = top of `cohort`) as a normal z-score. */
export function withinSchoolZ(rank: number, cohort: number): number {
  const n = Math.max(1, Math.round(cohort));
  const r = Math.min(n, Math.max(1, Math.round(rank)));
  return normInv((n - r + 0.5) / n);
}

/** Default spread (SD, percentage points) of SAC scores within a school class. */
export const DEFAULT_CLASS_SD = 12;

/**
 * Position within the school from the SAC score itself, as in VCAA's linear rescale:
 * (your SAC − class average) / class spread.
 */
export function withinSchoolZFromScore(scorePct: number, classAvgPct: number, classSdPct = DEFAULT_CLASS_SD): number {
  return (scorePct - classAvgPct) / Math.max(1, classSdPct);
}

export interface ModeratedSac {
  /** Moderated score on the GA's VCAA scale (0..ga.max). */
  score: number;
  low: number;
  high: number;
  /** Statewide percentile of the moderated score. */
  percentile: number;
  /** Position within the school used (z-score). */
  zWithin: number;
}

/** Moderated SAC score for a GA from a within-school position (z) and school strength. */
export function moderatedSacFromZ(ga: GradedAssessment, zWithin: number, strength: SchoolStrength): ModeratedSac {
  const at = (shift: number) => {
    const p = normCdf(strength.mean + shift + strength.sd * zWithin);
    return { p, score: gaQuantile(ga, Math.min(0.9995, Math.max(0.0005, p))) };
  };
  const mid = at(0);
  return { score: mid.score, low: at(-SUBJECT_UNCERTAINTY).score, high: at(SUBJECT_UNCERTAINTY).score, percentile: mid.p, zWithin };
}

/** Estimated moderated SAC score for a GA from rank and school strength. */
export function moderatedSac(ga: GradedAssessment, rank: number, cohort: number, strength: SchoolStrength): ModeratedSac {
  return moderatedSacFromZ(ga, withinSchoolZ(rank, cohort), strength);
}
