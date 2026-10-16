import { describe, expect, it } from 'vitest';
import { getStudy, STUDIES, LATEST_YEAR, YEARS } from './data';
import { scaledScore } from './scaling';
import { aggregateToAtar, calculateAggregate, atarToAggregate } from './atar';
import { estimateStudyScore, gradeFor, gaCdf, gaQuantile, requiredScore } from './studyScore';
import { normCdf, normInv } from './stats';

const study = (id: string) => {
  const s = getStudy(id);
  if (!s) throw new Error(id);
  return s;
};

// Two-decimal scaled scores printed in the worked examples of VTAC's ATAR and Scaling Guide.
const VTAC_EXAMPLES: [string, number, number, number][] = [
  ['EG', 2023, 34, 36.47], ['VC', 2023, 48, 47.76], ['NF', 2023, 43, 41.59], ['PY', 2023, 41, 40.21],
  ['HH', 2022, 40, 36.86], ['DA', 2021, 27, 26.13], ['EN', 2023, 31, 28.94], ['HH', 2023, 40, 37.25],
  ['PY', 2022, 34, 32.25], ['BM', 2023, 35, 31.99], ['VC', 2023, 35, 32.03], ['NF', 2023, 28, 25.41],
  ['LI', 2023, 42, 43.31], ['AL03', 2023, 40, 46.61], ['PL', 2023, 47, 47.51], ['NS', 2023, 36, 48.75],
  ['PH', 2023, 43, 45.31], ['EN', 2023, 17, 14.07], ['CL', 2023, 28, 39.2], ['NS', 2023, 17, 23.59],
  ['AL03', 2023, 18, 23.02], ['AC', 2022, 18, 17.53], ['PH', 2023, 17, 17.3],
];

describe('stats', () => {
  it('normal CDF and inverse agree', () => {
    for (const p of [0.001, 0.02, 0.3, 0.5, 0.8, 0.99, 0.9995]) expect(normCdf(normInv(p))).toBeCloseTo(p, 6);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
  });
});

describe('scaling', () => {
  it('passes through the published points', () => {
    for (const s of STUDIES) {
      const row = s.scaling[LATEST_YEAR];
      if (!row || row === 'small') continue;
      [20, 25, 30, 35, 40, 45, 50].forEach((x, i) => expect(scaledScore(s, x, LATEST_YEAR)).toBeCloseTo(row.points[i], 6));
    }
  });

  it('matches VTAC two-decimal examples closely', () => {
    const errors = VTAC_EXAMPLES.map(([id, y, ss, expected]) => Math.abs(scaledScore(study(id), ss, y)! - expected));
    const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(mae).toBeLessThan(0.25);
    expect(Math.max(...errors)).toBeLessThan(0.6);
  });

  it('is monotone in the study score', () => {
    for (const s of STUDIES) {
      let prev = -1;
      for (let x = 0; x <= 50; x += 0.5) {
        const v = scaledScore(s, x, LATEST_YEAR);
        if (v === null) break;
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });
});

describe('aggregate and ATAR', () => {
  it('uses the official tables', () => {
    expect(aggregateToAtar(208.08, 2025).atar).toBe(99.9);
    expect(aggregateToAtar(208.07, 2025).atar).toBe(99.85);
    expect(aggregateToAtar(155.19, 2025).atar).toBe(90);
    expect(aggregateToAtar(60, 2025).below30).toBe(true);
    expect(atarToAggregate(90, 2025)).toBe(155.19);
    for (const y of YEARS) expect(aggregateToAtar(250, y).atar).toBe(99.95);
  });

  // VTAC guide examples, converted with the 2023 aggregate-to-ATAR table.
  it.each([
    [172.32, 95.65],
    [136.17, 80.3],
    [195.71, 99.3],
    [103.36, 57.15],
  ])('aggregate %f -> ATAR %f (2023)', (agg, atar) => {
    expect(aggregateToAtar(agg, 2023).atar).toBe(atar);
  });

  it('builds the primary four and truncated increments', () => {
    const r = calculateAggregate(
      [
        { studyId: 'EN', studyScore: 35 },
        { studyId: 'NJ', studyScore: 35 },
        { studyId: 'NS', studyScore: 35 },
        { studyId: 'CH', studyScore: 35 },
        { studyId: 'PH', studyScore: 35 },
        { studyId: 'PY', studyScore: 35 },
      ],
      2025,
    );
    expect(r.eligible).toBe(true);
    const primary = r.rows.filter((x) => x.role === 'primary');
    const inc = r.rows.filter((x) => x.role === 'increment');
    expect(primary.map((x) => x.study!.id)).toContain('EN');
    expect(primary).toHaveLength(4);
    expect(inc).toHaveLength(2);
    for (const x of inc) expect(x.contribution).toBe(Math.floor(x.scaled! * 10 + 1e-9) / 100);
    const sum = r.rows.reduce((s, x) => s + x.contribution, 0);
    expect(r.aggregate).toBeCloseTo(sum, 6);
  });

  it('limits a study area grouping to two in the primary four and three overall', () => {
    const r = calculateAggregate(
      [
        { studyId: 'EN', studyScore: 25 },
        { studyId: 'NS', studyScore: 45 },
        { studyId: 'NJ', studyScore: 45 },
        { studyId: 'NF', studyScore: 45 },
        { studyId: 'MA10', studyScore: 45 },
        { studyId: 'BI', studyScore: 20 },
        { studyId: 'HH', studyScore: 20 },
      ],
      2025,
    );
    const maths = r.rows.filter((x) => x.study?.group === 'Mathematics');
    expect(maths.filter((x) => x.role === 'primary')).toHaveLength(2);
    expect(maths.filter((x) => x.role !== 'unused')).toHaveLength(3);
  });

  it('counts only one of English and EAL', () => {
    const r = calculateAggregate(
      [
        { studyId: 'EN', studyScore: 30 },
        { studyId: 'EF', studyScore: 40 },
        { studyId: 'BI', studyScore: 30 },
        { studyId: 'CH', studyScore: 30 },
        { studyId: 'PY', studyScore: 30 },
      ],
      2025,
    );
    const used = r.rows.filter((x) => x.role !== 'unused').map((x) => x.study?.id);
    expect(used.includes('EN') && used.includes('EF')).toBe(false);
  });

  it('does not count a duplicate primary study as an increment', () => {
    const base = [
      { studyId: 'EN', studyScore: 30 },
      { studyId: 'CH', studyScore: 40 },
      { studyId: 'BI', studyScore: 35 },
      { studyId: 'PH', studyScore: 35 },
    ];
    const expected = calculateAggregate(base, 2025);
    const result = calculateAggregate([...base, { studyId: 'CH', studyScore: 40 }], 2025);
    expect(result.aggregate).toBe(expected.aggregate);
    expect(result.rows.filter((r) => r.study?.id === 'CH' && r.role !== 'unused')).toHaveLength(1);
  });

  it('excludes equivalents of every primary study from increments', () => {
    const result = calculateAggregate([
      { studyId: 'EN', studyScore: 30 },
      { studyId: 'CL', studyScore: 45 },
      { studyId: 'CK', studyScore: 45 },
      { studyId: 'BI', studyScore: 35 },
      { studyId: 'PH', studyScore: 35 },
    ], 2025);
    expect(result.rows.filter((r) => ['CL', 'CK'].includes(r.study?.id ?? '') && r.role !== 'unused')).toHaveLength(1);
    expect(result.aggregate).toBe(153);
  });

  it('requires an English study and four studies', () => {
    expect(calculateAggregate([{ studyId: 'BI', studyScore: 30 }, { studyId: 'CH', studyScore: 30 }, { studyId: 'PY', studyScore: 30 }, { studyId: 'PH', studyScore: 30 }], 2025).eligible).toBe(false);
    expect(calculateAggregate([{ studyId: 'EN', studyScore: 30 }, { studyId: 'CH', studyScore: 30 }, { studyId: 'PY', studyScore: 30 }], 2025).eligible).toBe(false);
  });

  it('adds higher education and non-scored VET increments', () => {
    const base = [
      { studyId: 'EN', studyScore: 30 },
      { studyId: 'BI', studyScore: 30 },
      { studyId: 'CH', studyScore: 30 },
      { studyId: 'PY', studyScore: 30 },
    ];
    const r = calculateAggregate(base, 2025, { higherEducationMark: 92, nonScoredVet: 1 });
    const inc = r.rows.filter((x) => x.role === 'increment');
    expect(inc.map((x) => x.contribution)).toContain(5);
    const fourth = Math.min(...r.rows.filter((x) => x.role === 'primary').map((x) => x.contribution));
    expect(inc.map((x) => x.contribution)).toContain(Math.floor(fourth * 10 + 1e-9) / 100);
  });
});

describe('study score', () => {
  const methods = study('NJ');
  const gas = methods.assessment!.gas;

  it('has weights that sum to 100 and GA data for every modelled study', () => {
    for (const s of STUDIES) {
      if (!s.assessment) continue;
      expect(s.assessment.gas.reduce((t, g) => t + g.weight, 0)).toBeCloseTo(100, 6);
      for (const g of s.assessment.gas) expect(g.grades.reduce((t, b) => t + b.n, 0)).toBe(g.n);
    }
  });

  it('uses official grade cut-offs', () => {
    // 2025 Mathematical Methods Exam 1 (out of 80): A+ from 72.
    expect(gradeFor(gas[1], 72)).toBe('A+');
    expect(gradeFor(gas[1], 71)).toBe('A');
    expect(gaQuantile(gas[1], gaCdf(gas[1], 50))).toBeCloseTo(50, 6);
  });

  it('gives about 30 for a median student and is monotone', () => {
    const median = gas.map((g) => gaQuantile(g, 0.5));
    const e = estimateStudyScore(methods, median);
    expect(e.studyScore).toBeGreaterThan(28.5);
    expect(e.studyScore).toBeLessThan(31.5);
    let prev = 0;
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9, 0.97, 0.995]) {
      const ss = estimateStudyScore(methods, gas.map((g) => gaQuantile(g, p))).studyScore;
      expect(ss).toBeGreaterThan(prev);
      prev = ss;
    }
    const top = estimateStudyScore(methods, gas.map((g) => g.max));
    expect(top.studyScore).toBeGreaterThan(48);
    expect(top.low).toBeLessThanOrEqual(top.studyScore);
  });

  it('solves for the exam score needed', () => {
    const scores = [80, 60, 100];
    const need = requiredScore(methods, scores, 2, 35)!;
    const s = scores.slice();
    s[2] = need;
    expect(estimateStudyScore(methods, s).studyScore).toBeCloseTo(35, 1);
    expect(requiredScore(methods, scores, 2, 45)).toBeNull();
  });
});
