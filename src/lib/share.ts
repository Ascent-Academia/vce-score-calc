import { getStudy, LATEST_YEAR, YEARS } from './data';
import type { ExtraIncrements } from './atar';

interface SharedRow {
  studyId: string | null;
  studyScore: string;
}

export interface SharedCalculation {
  year: number;
  rows: SharedRow[];
  extras: ExtraIncrements;
}

/** Preserve every input affecting the ATAR, including the chosen historical tables. */
export function encodeSharedCalculation({ year, rows, extras }: SharedCalculation): string {
  const params = new URLSearchParams({
    s: rows.filter((r) => r.studyId).map((r) => `${r.studyId}:${r.studyScore}`).join(','),
    year: String(year),
  });
  if (extras.nonScoredVet != null) params.set('vet', String(extras.nonScoredVet));
  if (extras.higherEducationMark != null) params.set('he', String(extras.higherEducationMark));
  return params.toString();
}

/** Legacy subject-only links continue to use the latest tables and no extra increments. */
export function decodeSharedCalculation(hash: string): SharedCalculation | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('s')) return null;
  const subjects = params.get('s')!;
  const rows = subjects ? subjects.split(',').map((p) => {
    const [id, score] = p.split(':');
    return { studyId: getStudy(id) ? id : null, studyScore: score ?? '' };
  }) : [];
  const year = Number(params.get('year'));
  const extras: ExtraIncrements = {};
  const vet = Number(params.get('vet'));
  if (params.has('vet') && Number.isInteger(vet) && vet >= 0 && vet <= 2) extras.nonScoredVet = vet;
  const he = Number(params.get('he'));
  if (params.has('he') && Number.isFinite(he) && he >= 0 && he <= 100) extras.higherEducationMark = he;
  return { year: YEARS.includes(year) ? year : LATEST_YEAR, rows, extras };
}
