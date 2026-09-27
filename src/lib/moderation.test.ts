import { describe, expect, it } from 'vitest';
import { getStudy } from './data';
import { DEFAULT_CLASS_SD, SCHOOLS, findSchool, isModerated, moderatedGas, moderatedSac, moderatedSacFromZ, presetStrength, schoolKey, schoolStrength, strengthFrom, withinSchoolZ, withinSchoolZFromScore } from './moderation';
import { gaCdf } from './studyScore';

const methods = getStudy('NJ')!;
const sac = methods.assessment!.gas[0];
const byName = (re: RegExp) => SCHOOLS.find((s) => re.test(s.name))!;

describe('school data', () => {
  it('loads the VCAA per-school figures', () => {
    expect(SCHOOLS.length).toBeGreaterThan(400);
    const s = byName(/^Melbourne High School$/);
    expect(findSchool(schoolKey(s))).toBe(s);
    for (const [median, p40] of Object.values(s.years)) {
      expect(median).toBeGreaterThanOrEqual(30);
      expect(p40).toBeGreaterThan(10);
    }
  });
});

describe('school strength', () => {
  it('maps median to level and 40+ share to spread', () => {
    const avg = strengthFrom(30, 7.7); // statewide: 7.7% of study scores are 40+
    expect(avg.mean).toBeCloseTo(0, 6);
    expect(avg.sd).toBeGreaterThan(0.9);
    expect(avg.sd).toBeLessThan(1.05);
    expect(strengthFrom(24, 0).sd).toBe(0.9); // falls back when 40+ share is uninformative
    expect(strengthFrom(36, 30).mean).toBeCloseTo(6 / 7, 6);
  });

  it('ranks selective schools above others', () => {
    const selective = schoolStrength(byName(/^Melbourne High School$/));
    const other = schoolStrength(byName(/^Hallam Senior Sec College$/));
    expect(selective.mean).toBeGreaterThan(0.7);
    expect(other.mean).toBeLessThan(-0.5);
    expect(presetStrength('preset-29')!.mean).toBeCloseTo(-1 / 7, 6);
  });
});

describe('moderated SAC', () => {
  it('only moderates coursework', () => {
    expect(moderatedGas(methods).map((g) => g.ga)).toEqual([1]);
    const vcd = getStudy('VC')!;
    expect(vcd.assessment!.gas.filter(isModerated).map((g) => g.title)).toEqual(['COURSEWORK UNIT 3']);
  });

  it('keeps rank order and is centred for a middle student at an average school', () => {
    expect(withinSchoolZ(1, 25)).toBeGreaterThan(withinSchoolZ(2, 25));
    expect(withinSchoolZ(13, 25)).toBeCloseTo(0, 6);
    const mid = moderatedSac(sac, 13, 25, strengthFrom(30, 7.7));
    expect(gaCdf(sac, mid.score)).toBeCloseTo(0.5, 2);
  });

  it('is worth more at a stronger school for the same rank', () => {
    const top = (school: RegExp) => moderatedSac(sac, 3, 30, schoolStrength(byName(school))).score;
    expect(top(/^Melbourne High School$/)).toBeGreaterThan(top(/^Hallam Senior Sec College$/));
    const r = moderatedSac(sac, 3, 30, schoolStrength(byName(/^Hallam Senior Sec College$/)));
    expect(r.low).toBeLessThanOrEqual(r.score);
    expect(r.high).toBeGreaterThanOrEqual(r.score);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(sac.max);
  });

  it('uses the SAC score relative to the class average like VCAA\'s linear rescale', () => {
    expect(withinSchoolZFromScore(80, 80)).toBe(0);
    expect(withinSchoolZFromScore(92, 80)).toBeCloseTo(12 / DEFAULT_CLASS_SD, 6);
    expect(withinSchoolZFromScore(92, 80, 6)).toBeCloseTo(2, 6);
    const strength = schoolStrength(byName(/^Box Hill High School$/));
    const at = (pct: number) => moderatedSacFromZ(sac, withinSchoolZFromScore(pct, 75), strength).score;
    // Higher raw SAC at the same school → higher moderated SAC; class average → school level.
    expect(at(95)).toBeGreaterThan(at(85));
    expect(at(85)).toBeGreaterThan(at(75));
    expect(gaCdf(sac, at(75))).toBeCloseTo(normCdfLocal(strength.mean), 2);
  });
});

function normCdfLocal(z: number) {
  // Standard normal CDF via erf approximation, independent of the code under test.
  const t = 1 / (1 + 0.5 * Math.abs(z / Math.SQRT2));
  const y = t * Math.exp(-(z * z) / 2 - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return z >= 0 ? 1 - y / 2 : y / 2;
}
