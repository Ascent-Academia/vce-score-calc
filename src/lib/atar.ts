// VTAC aggregate and ATAR rules (VTAC ATAR and Scaling Guide).
//
// Aggregate = primary four + up to two increments, where
//  - the primary four is the best permissible English study plus the next three best
//    permissible scaled scores (VCE or scored VCE VET),
//  - increments are 10% of the 5th/6th permissible scaled scores, or a non-scored
//    VCE VET / VE3 increment (10% of the 4th primary score), or a higher education
//    study increment (3.0–5.0 by mark),
//  - at most 2 studies from one study area grouping in the primary four, at most 3
//    in the aggregate, and only one study of each equivalent set.
// VTAC truncates increments to 2 d.p. (e.g. 10% of 36.86 counts as 3.68).
import { ATAR_TABLES, getStudy, scalingYearFor, type Study } from './data';
import { scaledScore } from './scaling';

export interface SubjectEntry {
  studyId: string;
  studyScore: number;
}

export interface ExtraIncrements {
  /** Non-scored VCE VET or VE3 sequences (each worth 10% of the 4th primary score). */
  nonScoredVet?: number;
  /** Average mark (%) in an approved higher education study. */
  higherEducationMark?: number | null;
}

export type Role = 'primary' | 'increment' | 'unused';

export interface ContributionRow {
  key: string;
  label: string;
  study?: Study;
  studyScore?: number;
  scaled?: number;
  scalingYear?: number | null;
  role: Role;
  contribution: number;
  note?: string;
}

export interface AggregateResult {
  eligible: boolean;
  reason?: string;
  aggregate: number;
  rows: ContributionRow[];
}

interface Candidate {
  key: string;
  study: Study;
  studyScore: number;
  scaled: number;
  scalingYear: number;
}

const floor2 = (v: number) => Math.floor(v * 100 + 1e-9) / 100;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function higherEducationIncrement(mark: number | null | undefined): number {
  if (mark == null || Number.isNaN(mark)) return 0;
  if (mark >= 90) return 5;
  if (mark >= 80) return 4.5;
  if (mark >= 70) return 4;
  if (mark >= 60) return 3.5;
  if (mark >= 50) return 3;
  return 0;
}

function conflicts(a: Study, b: Study): boolean {
  if (a.id === b.id) return true;
  return a.equivalents.some((e) => b.equivalents.includes(e));
}

function groupCounts(list: Candidate[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of list) if (c.study.group) m.set(c.study.group, (m.get(c.study.group) ?? 0) + 1);
  return m;
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc.slice();
    return;
  }
  for (let i = start; i < items.length; i++) {
    acc.push(items[i]);
    yield* combinations(items, k, i + 1, acc);
    acc.pop();
  }
}

export function calculateAggregate(entries: SubjectEntry[], year: number, extras: ExtraIncrements = {}): AggregateResult {
  const candidates: Candidate[] = [];
  const rows: ContributionRow[] = [];
  entries.forEach((e, i) => {
    const study = getStudy(e.studyId);
    if (!study || !Number.isFinite(e.studyScore)) return;
    const scalingYear = scalingYearFor(study, year);
    const scaled = scalingYear ? scaledScore(study, e.studyScore, scalingYear) : null;
    if (scaled === null || scalingYear === null) {
      rows.push({ key: `s${i}`, label: study.name, study, studyScore: e.studyScore, role: 'unused', contribution: 0, note: 'No VTAC scaling data' });
      return;
    }
    candidates.push({ key: `s${i}`, study, studyScore: e.studyScore, scaled, scalingYear });
  });

  const nonScored = Math.max(0, Math.min(2, Math.floor(extras.nonScoredVet ?? 0)));
  const heInc = higherEducationIncrement(extras.higherEducationMark);

  let best: { total: number; primary: Candidate[]; incs: { c?: Candidate; kind: 'study' | 'vet' | 'he'; value: number }[] } | null = null;

  for (const english of candidates.filter((c) => c.study.english)) {
    const others = candidates.filter((c) => c !== english && !conflicts(c.study, english.study));
    const k = Math.min(3, others.length);
    for (const trio of combinations(others, k)) {
      const primary = [english, ...trio];
      if (primary.some((a, i) => primary.some((b, j) => i < j && conflicts(a.study, b.study)))) continue;
      const pc = groupCounts(primary);
      if ([...pc.values()].some((n) => n > 2)) continue;
      const primarySum = primary.reduce((s, c) => s + c.scaled, 0);
      const fourth = Math.min(...primary.map((c) => c.scaled));

      // Increment options.
      const rest = others.filter((c) => !trio.includes(c));
      const options: { c?: Candidate; kind: 'study' | 'vet' | 'he'; value: number }[] = rest.map((c) => ({ c, kind: 'study', value: floor2(c.scaled * 0.1) }));
      if (primary.length === 4) for (let v = 0; v < nonScored; v++) options.push({ kind: 'vet', value: floor2(fourth * 0.1) });
      if (heInc > 0) options.push({ kind: 'he', value: heInc });

      let bestInc: { total: number; incs: typeof options } = { total: 0, incs: [] };
      const consider = (incs: typeof options) => {
        const studies = incs.filter((o) => o.c).map((o) => o.c!);
        if (studies.length === 2 && conflicts(studies[0].study, studies[1].study)) return;
        const counts = groupCounts([...primary, ...studies]);
        if ([...counts.values()].some((n) => n > 3)) return;
        const total = incs.reduce((s, o) => s + o.value, 0);
        if (total > bestInc.total + 1e-9) bestInc = { total, incs };
      };
      options.forEach((a, i) => {
        consider([a]);
        options.slice(i + 1).forEach((b) => consider([a, b]));
      });

      const total = round2(primarySum + bestInc.total);
      if (!best || total > best.total + 1e-9) best = { total, primary, incs: bestInc.incs };
    }
  }

  const englishCount = candidates.filter((c) => c.study.english).length;
  if (!best || best.primary.length < 4) {
    for (const c of candidates) rows.push({ key: c.key, label: c.study.name, study: c.study, studyScore: c.studyScore, scaled: c.scaled, scalingYear: c.scalingYear, role: 'unused', contribution: 0 });
    return {
      eligible: false,
      reason: englishCount === 0 ? 'An ATAR needs a study score in an English study (English, EAL, English Language or Literature).' : 'An ATAR needs study scores in at least four permissible studies.',
      aggregate: best ? best.total : 0,
      rows: sortRows(rows),
    };
  }

  const used = new Set<Candidate>();
  for (const c of best.primary) {
    used.add(c);
    rows.push({ key: c.key, label: c.study.name, study: c.study, studyScore: c.studyScore, scaled: c.scaled, scalingYear: c.scalingYear, role: 'primary', contribution: c.scaled });
  }
  let vetN = 0;
  for (const inc of best.incs) {
    if (inc.c) {
      used.add(inc.c);
      rows.push({ key: inc.c.key, label: inc.c.study.name, study: inc.c.study, studyScore: inc.c.studyScore, scaled: inc.c.scaled, scalingYear: inc.c.scalingYear, role: 'increment', contribution: inc.value, note: '10% of scaled score' });
    } else if (inc.kind === 'vet') {
      rows.push({ key: `vet${vetN++}`, label: 'Non-scored VCE VET / VE3', role: 'increment', contribution: inc.value, note: '10% of 4th primary score' });
    } else {
      rows.push({ key: 'he', label: 'Higher education study', role: 'increment', contribution: inc.value, note: `Mark ${extras.higherEducationMark}` });
    }
  }
  for (const c of candidates) {
    if (used.has(c)) continue;
    const eq = [...used].find((u) => conflicts(u.study, c.study));
    rows.push({
      key: c.key,
      label: c.study.name,
      study: c.study,
      studyScore: c.studyScore,
      scaled: c.scaled,
      scalingYear: c.scalingYear,
      role: 'unused',
      contribution: 0,
      note: eq ? `Equivalent to ${eq.study.name}` : 'Not in best six (or study area grouping limit)',
    });
  }
  return { eligible: true, aggregate: best.total, rows: sortRows(rows) };
}

function sortRows(rows: ContributionRow[]): ContributionRow[] {
  const order: Record<Role, number> = { primary: 0, increment: 1, unused: 2 };
  return rows.sort((a, b) => order[a.role] - order[b.role] || (b.study?.english ? 1 : 0) - (a.study?.english ? 1 : 0) || b.contribution - a.contribution || (b.scaled ?? 0) - (a.scaled ?? 0));
}

export interface AtarResult {
  atar: number | null;
  /** True when the aggregate is below the 30.00 threshold ("less than 30"). */
  below30: boolean;
}

/** Converts an aggregate to an ATAR with VTAC's official aggregate-to-ATAR table for the year. */
export function aggregateToAtar(aggregate: number, year: number): AtarResult {
  const table = ATAR_TABLES[year];
  if (!table) throw new Error(`No ATAR table for ${year}`);
  const agg = round2(aggregate);
  for (const [atar, min] of table) if (agg >= min) return { atar, below30: false };
  return { atar: null, below30: true };
}

/** Minimum aggregate for an ATAR in a given year (null if outside the table). */
export function atarToAggregate(atar: number, year: number): number | null {
  const table = ATAR_TABLES[year];
  const row = table.find(([a]) => a <= atar + 1e-9);
  return row ? row[1] : null;
}
