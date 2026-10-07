import { describe, expect, it } from 'vitest';
import { LATEST_YEAR } from './data';
import { aggregateToAtar, calculateAggregate } from './atar';
import { decodeSharedCalculation, encodeSharedCalculation, type SharedCalculation } from './share';

const rows = [
  { studyId: 'EN', studyScore: '32' },
  { studyId: 'CH', studyScore: '33' },
  { studyId: 'PY', studyScore: '34' },
  { studyId: 'BI', studyScore: '31' },
];

describe('shared calculations', () => {
  it('preserves the year and extra increments so recipients get the same ATAR', () => {
    const original = { year: 2023, rows, extras: { nonScoredVet: 1, higherEducationMark: 85 } };
    const restored = decodeSharedCalculation(`#${encodeSharedCalculation(original)}`)!;
    expect(restored).toEqual(original);
    const resultFor = (s: SharedCalculation) => {
      const entries = s.rows.filter((r) => r.studyId).map((r) => ({ studyId: r.studyId!, studyScore: Number(r.studyScore) }));
      const aggregate = calculateAggregate(entries, s.year, s.extras).aggregate;
      return { aggregate, ...aggregateToAtar(aggregate, s.year) };
    };
    expect(resultFor(restored)).toEqual(resultFor(original));
  });

  it('continues to open legacy links with the latest tables', () => {
    expect(decodeSharedCalculation('#s=EN:32,CH:33')).toEqual({ year: LATEST_YEAR, rows: rows.slice(0, 2), extras: {} });
  });

  it('can share an empty calculation without restoring browser-saved subjects', () => {
    expect(decodeSharedCalculation(encodeSharedCalculation({ year: 2023, rows: [], extras: {} }))?.rows).toEqual([]);
    expect(decodeSharedCalculation('#unrelated=value')).toBeNull();
  });

  it('ignores invalid metadata and unknown subject IDs', () => {
    expect(decodeSharedCalculation('#s=unknown:30&year=1000&vet=99&he=Infinity')).toEqual({
      year: LATEST_YEAR, rows: [{ studyId: null, studyScore: '30' }], extras: {},
    });
  });
});
