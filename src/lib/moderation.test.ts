import { describe, expect, it } from 'vitest';
import { getStudy } from './data';
import { SCHOOLS, findSchool, isModerated, moderatedGas, moderatedSac, presetStrength, schoolKey, schoolStrength, strengthFrom, withinSchoolZ } from './moderation';
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
});
