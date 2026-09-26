// Parses the official files in data/raw/ (see fetch-data.mjs) into src/data/*.json.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pdfItems, pdfRows } from './pdf-text.mjs';
import { VTAC_FILES, GA_YEAR, SSCAI_PAGE, SSCAI_YEARS } from './sources.mjs';
import readXlsxFile from 'read-excel-file/node';

const RAW = new URL('../data/raw/', import.meta.url).pathname;
const OUT = new URL('../src/data/', import.meta.url).pathname;
const VTAC_YEARS = Object.keys(VTAC_FILES).map(Number);

const VTAC_FILES_URLS = (kind) => VTAC_YEARS.map((y) => [y, `https://vtac.edu.au/files/pdf/reports/${VTAC_FILES[y][kind]}`]);

const num = (s) => Number(String(s).replace(/,/g, ''));
const isNum = (s) => /^-?[\d,]+(\.\d+)?$/.test(s);

// ---------------------------------------------------------------------------
// VTAC scaling report: code, study, mean, sd, scaled score at 20..50.
// ---------------------------------------------------------------------------
async function parseScaling(year) {
  const pages = await pdfRows(join(RAW, 'vtac', `scaling-report-${year}.pdf`));
  const studies = [];
  let section = null;
  for (const rows of pages.slice(0, 2)) {
    const header = rows.findIndex((r) => r[0] === 'Code');
    if (header < 0) throw new Error(`scaling ${year}: header not found`);
    for (const row of rows.slice(header + 1)) {
      if (row[0] === 'Note:') break;
      if (row.length === 1 && row[0].endsWith(':')) {
        section = row[0].slice(0, -1).trim();
        continue;
      }
      if (/^\d+ December \d{4}$|^\d of \d$/.test(row[0])) continue;
      let code = null;
      let rest = row;
      if (/^[A-Z]{2}(\d{2})?$/.test(row[0])) [code, ...rest] = row;
      const [name, ...values] = rest;
      if (!name || (!code && !/small LOTEs/i.test(name))) throw new Error(`scaling ${year}: unexpected row ${JSON.stringify(row)}`);
      if (values.length === 1 && values[0].startsWith('Small Study')) {
        studies.push({ code, name, section, small: true, mean: null, sd: null, points: null });
        continue;
      }
      if (!values.every(isNum)) throw new Error(`scaling ${year}: bad values ${JSON.stringify(row)}`);
      const nums = values.map(num);
      let mean = null;
      let sd = null;
      let points;
      if (nums.length === 9) [mean, sd, ...points] = nums;
      else if (nums.length === 7) points = nums;
      else throw new Error(`scaling ${year}: ${name} has ${nums.length} numbers`);
      if (points.some((v, k) => k > 0 && v < points[k - 1])) throw new Error(`scaling ${year}: ${name} not monotone`);
      studies.push({ code, name, section, small: false, mean, sd, points });
    }
  }
  return studies;
}

// ---------------------------------------------------------------------------
// VTAC aggregate to ATAR table: ATAR, min aggregate, max aggregate.
// ---------------------------------------------------------------------------
async function parseAtar(year) {
  const pages = await pdfItems(join(RAW, 'vtac', `atar-to-aggregate-${year}.pdf`));
  const tokens = pages.flat();
  const rows = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const a = t === '< 30' ? null : isNum(t) && /^\d{2}\.\d{2}$/.test(t) ? num(t) : undefined;
    if (a === undefined) continue;
    const lo = tokens[i + 1];
    const hi = tokens[i + 2];
    if (!isNum(lo) || !isNum(hi) || !/\./.test(lo) || !/\./.test(hi)) continue;
    rows.push([a, num(lo), num(hi)]);
    i += 2;
  }
  // Sanity checks: strictly decreasing ATARs in 0.05 steps down to 30.00, contiguous ranges.
  const ranked = rows.filter((r) => r[0] !== null);
  if (ranked[0][0] !== 99.95 || ranked.at(-1)[0] !== 30) throw new Error(`atar ${year}: bad bounds`);
  for (let k = 1; k < ranked.length; k++) {
    if (Math.abs(ranked[k - 1][0] - ranked[k][0] - 0.05) > 1e-6) throw new Error(`atar ${year}: gap at ${ranked[k][0]}`);
    if (ranked[k][2] > ranked[k - 1][1]) throw new Error(`atar ${year}: overlap at ${ranked[k][0]}`);
  }
  // Store [atar, minimum aggregate] from highest to lowest (30.00).
  return ranked.map(([a, lo]) => [a, lo]);
}

// ---------------------------------------------------------------------------
// VCAA grade distributions: one PDF per study, one page per graded assessment.
// ---------------------------------------------------------------------------
const GRADES = ['UG', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+'];

function parseGaPage(tokens, file) {
  const gaIdx = tokens.findIndex((t) => /^Graded Assessment \d+$/.test(t));
  if (gaIdx < 0) throw new Error(`${file}: no GA label`);
  const study = tokens[gaIdx - 1];
  const ga = Number(tokens[gaIdx].split(' ').pop());
  const title = tokens[gaIdx + 1];

  let t = -1;
  for (let k = 0; k < tokens.length - 1; k++) if (tokens[k] === 'Total' && tokens[k + 1] === 'n') t = k;
  if (t < 0) throw new Error(`${file} GA${ga}: no totals row`);
  const counts = tokens.slice(t + 2, t + 2 + 13).map(num); // 11 grades, NR, total
  if (counts.some(Number.isNaN)) throw new Error(`${file} GA${ga}: bad counts`);

  // The 11 grade score ranges (then "N/A" for NR) sit directly before "Max <n>".
  // A grade that nobody could receive is shown as "-".
  const maxIdx = tokens.findIndex((x) => /^Max \d+$/.test(x));
  const ranges = tokens.slice(maxIdx - 12, maxIdx - 1);
  if (tokens[maxIdx - 1] !== 'N/A' || !ranges.every((x) => x === '-' || /^\d+-\d+$/.test(x)))
    throw new Error(`${file} GA${ga}: unexpected score ranges ${ranges.join(' ')}`);
  const max = Number(tokens[maxIdx].split(' ')[1]);
  let mean;
  let sd;
  if (tokens[maxIdx + 1] === 'Mean') {
    mean = num(tokens[maxIdx + 2]);
    sd = num(tokens[maxIdx + 4]);
  } else {
    mean = num(tokens[maxIdx + 1]);
    sd = num(tokens[maxIdx + 2]);
  }
  if (!(mean >= 0 && sd > 0)) throw new Error(`${file} GA${ga}: bad mean/sd`);

  const grades = GRADES.map((g, k) => {
    if (ranges[k] === '-') return { grade: g, lo: null, hi: null, n: counts[k] };
    const [lo, hi] = ranges[k].split('-').map(Number);
    return { grade: g, lo, hi, n: counts[k] };
  });
  return { study, ga, title, max, mean, sd, n: counts[12] - counts[11], grades };
}

async function parseGradeDistributions() {
  const dir = join(RAW, 'vcaa', `ga${GA_YEAR}`);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.pdf')).sort();
  const out = [];
  for (const file of files) {
    const pages = await pdfItems(join(dir, file));
    const gas = pages.map((p) => parseGaPage(p, file));
    out.push({ file, study: gas[0].study, gas: gas.map(({ study: _study, ...rest }) => rest) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// VCAA assessment summary: graded assessment contributions to study scores.
// ---------------------------------------------------------------------------
async function parseWeights() {
  const html = await readFile(join(RAW, 'vcaa', 'assessment-summary.html'), 'utf8');
  const decode = (s) =>
    s
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#39;|&rsquo;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  const rows = [];
  for (const tr of html.matchAll(/<tr>(.*?)<\/tr>/gs)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) =>
      m[1].split(/<br\s*\/?>|<\/p>\s*<p>/).map(decode).filter(Boolean),
    );
    if (cells.length !== 4) continue;
    const [names, gaNums, types, weights] = cells;
    const w = weights.map(Number);
    if (w.some(Number.isNaN)) continue;
    const vet = /\(\w{2}\d{2}\)/.test(names.join(' '));
    const studies = [];
    if (vet) {
      const m = names.join(' ').match(/^(.*?)\s*\((\w{2}\d{2})\)/);
      studies.push({ name: m[1].trim(), code: m[2] });
    } else {
      for (const n of names) {
        const m = n.match(/^(.*?)\s+([A-Z]{2}\d{2})$/);
        if (m) studies.push({ name: m[1].replace(/^.*:/, '').trim(), code: m[2] });
      }
    }
    // Languages list an oral and a written component that together form GA3.
    const gas = [];
    const gaCount = gaNums.length;
    for (let g = 0; g < gaCount; g++) {
      if (g === gaCount - 1 && types.length > gaCount) {
        const comps = types.slice(g).map((t, k) => ({ title: t, weight: w[g + k] }));
        gas.push({ title: comps.map((c) => c.title).join(' + '), weight: comps.reduce((s, c) => s + c.weight, 0), components: comps });
      } else {
        gas.push({ title: types[g], weight: w[g] });
      }
    }
    const total = gas.reduce((s, g) => s + g.weight, 0);
    if (Math.abs(total - 100) > 0.01) throw new Error(`weights: ${names.join('/')} sum to ${total}`);
    for (const s of studies) rows.push({ ...s, vet, gas });
  }
  return rows;
}


// ---------------------------------------------------------------------------
// Catalogue: joins VTAC scaling rows, VCAA grade distributions and weights,
// and adds the VTAC study area groupings used by the ATAR rules.
// ---------------------------------------------------------------------------
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/\(vce vet\)|vce vet|\(hess\)/g, ' ')
    .replace(/^history\s+/, '')
    .replace(/&/g, 'and')
    .replace(/^applied computing:\s*/, '')
    .replace(/[^a-z]+/g, ' ')
    .trim();

// VTAC code -> names used by VCAA where automatic matching fails.
const ALIASES = {
  AI: 'aboriginal languages of victoria',
  EG47: 'engineering studies',
  HL08: 'health',
  IN60: 'information comms technology',
  MI19: 'music performance',
  MI30: 'music sound production',
  LO57: 'chinese language culture and society',
};
const WEIGHT_ALIASES = {
  HL08: 'health allied',
  HL06: 'health services assistance',
  IN60: 'information and communications technology',
  MI19: 'music performance',
  MI30: 'music sound production',
  EG47: 'engineering studies',
  AI: 'aboriginal languages of victoria',
};

// VTAC study area groupings (VTAC ATAR and Scaling Guide / study area groupings factsheet).
const GROUPS = {
  English: ['EN', 'EF', 'EG', 'LI'],
  Mathematics: ['MA10', 'NF', 'NJ', 'NS'],
  Music: ['MD', 'MC04', 'MC05', 'MC06', 'MI19', 'MI30'],
  History: ['HI17', 'HA', 'HR'],
  'Information Technology': ['AL03', 'IT02', 'IT03', 'IN60', 'ET16'],
  'Contemporary Society': ['SO03'],
  // VCE VET industry areas are treated as study area groupings.
  'Business Services': ['BU23'],
  'Community Services': ['CT41'],
  'Creative Arts and Culture': ['MU07', 'DN17', 'DN06'],
  Manufacturing: ['EG47', 'EG16', 'EG18'],
  'Racing and Breeding': ['EQ08'],
  Furnishing: ['FN40', 'FN19'],
  Health: ['HL08', 'HL06', 'CT37'],
  'Tourism, Travel and Hospitality': ['HS63', 'HS65', 'HS31', 'HS32'],
  'Laboratory Operations': ['LB26', 'LB21'],
  'Sport, Fitness and Recreation': ['SR80', 'SR41'],
};

// Equivalent studies: only one of each set can contribute to an aggregate.
// Includes the same language at different levels and studies replaced by a revised study.
const EQUIVALENTS = [
  ['EN', 'EF'],
  ['CN', 'CL', 'CK', 'LO57'],
  ['IN', 'IX'],
  ['JA', 'JS'],
  ['KO', 'KS'],
  ['LO54', 'LO31'],
  ['PS03', 'PS06'],
  ['PS05', 'PS06'],
  ['DN06', 'DN17'],
  ['EG16', 'EG18', 'EG47'],
  ['FN19', 'FN40'],
  ['HS31', 'HS32', 'HS63'],
  ['LB21', 'LB26'],
  ['SR41', 'SR80'],
];

function buildCatalogue(scaling, gaFiles, weights) {
  const years = Object.keys(scaling).map(Number).sort();
  const latest = years.at(-1);
  const rows = new Map();
  for (const y of years) {
    for (const r of scaling[y]) {
      const id = r.code ?? 'SMALL_LOTE';
      if (!rows.has(id)) rows.set(id, { id, name: r.name, scaling: {} });
      const row = rows.get(id);
      if (y === latest) row.name = r.name;
      // Small studies are scaled with that year's "All small LOTEs" row.
      row.scaling[y] = r.small ? 'small' : { mean: r.mean, sd: r.sd, points: r.points };
    }
  }
  // VCE and VCE VET studies can share a name (e.g. Dance), so key by both.
  const gaName = (g) => (g.file.startsWith('vet_') ? norm(g.file.replace(/^vet_|_?vce_vet_ga\d+\.pdf$/g, '').replace(/_/g, ' ')) : norm(g.study));
  const byGaName = new Map(gaFiles.map((g) => [`${g.file.startsWith('vet_')}:${gaName(g)}`, g]));
  const byWeightName = new Map(weights.map((w) => [`${w.vet}:${norm(w.name)}`, w]));
  const languageIds = new Set(years.flatMap((y) => scaling[y].filter((r) => r.section === 'Languages' && r.code).map((r) => r.code)));

  const studies = [];
  for (const row of rows.values()) {
    if (row.id === 'SMALL_LOTE') continue;
    const vet = row.name.startsWith('VCE VET ');
    const ga = byGaName.get(`${vet}:${ALIASES[row.id] ?? norm(row.name)}`);
    const wt = byWeightName.get(`${vet}:${WEIGHT_ALIASES[row.id] ?? norm(row.name)}`);
    let group = Object.entries(GROUPS).find(([, ids]) => ids.includes(row.id))?.[0] ?? null;
    if (languageIds.has(row.id)) group = 'Languages';
    let assessment = null;
    if (ga && wt && ga.gas.length === wt.gas.length) {
      assessment = {
        file: ga.file,
        weightsCode: wt.code,
        gas: ga.gas.map((g, k) => ({ ...g, label: wt.gas[k].title, weight: wt.gas[k].weight, components: wt.gas[k].components })),
      };
    } else if (ga || wt) {
      console.warn(`catalogue: ${row.id} ${row.name} has ${ga ? ga.gas.length : 0} GAs / ${wt ? wt.gas.length : 0} weights`);
    }
    studies.push({
      id: row.id,
      name: row.name.replace(/^VCE VET /, '') + (vet ? ' (VCE VET)' : ''),
      vet,
      group,
      english: GROUPS.English.includes(row.id),
      equivalents: EQUIVALENTS.filter((set) => set.includes(row.id)).map((set) => set.join('|')),
      language: languageIds.has(row.id),
      scaling: row.scaling,
      assessment,
    });
  }
  const small = Object.fromEntries(years.map((y) => [y, scaling[y].find((r) => r.code === null)?.points ?? null]));
  studies.sort((a, b) => a.name.localeCompare(b.name));
  const missing = studies.filter((s) => !s.assessment).map((s) => `${s.id} ${s.name}`);
  if (missing.length) console.log(`catalogue: no study score data for ${missing.length}: ${missing.join(', ')}`);
  const used = new Set(studies.filter((s) => s.assessment).map((s) => s.assessment.file));
  return { studies, smallLote: small, unmatchedGa: gaFiles.filter((g) => !used.has(g.file)).map((g) => g.file) };
}


// ---------------------------------------------------------------------------
// VCAA SSCAI: per-school median study score and % of study scores 40+.
// Columns are located by header text so layout changes between years are caught.
// ---------------------------------------------------------------------------
async function parseSscai(year) {
  const [{ data: rows }] = await readXlsxFile(join(RAW, 'vcaa', `sscai-${year}.xlsx`));
  const h = rows.findIndex((r) => r[0] === 'School');
  if (h < 0) throw new Error(`SSCAI ${year}: header row not found`);
  const header = rows[h].map((c) => String(c ?? '').replace(/\s+/g, ' ').trim());
  const col = (re) => {
    const i = header.findIndex((c) => re.test(c));
    if (i < 0) throw new Error(`SSCAI ${year}: column ${re} not found`);
    return i;
  };
  const cName = 0;
  const cLocality = col(/^Locality$/i);
  const cStudents = col(/^Number of students enrolled in at least one VCE/i);
  const cMedian = col(/^Median VCE study score$/i);
  const cP40 = col(/^Percentage of study scores of 40 and over$/i);
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const name = typeof r[cName] === 'string' ? r[cName].trim() : '';
    if (!name) continue;
    const median = typeof r[cMedian] === 'number' ? r[cMedian] : null;
    const p40 = typeof r[cP40] === 'number' ? r[cP40] : null;
    const students = typeof r[cStudents] === 'number' ? r[cStudents] : null;
    if (median === null) continue; // no VCE study scores (VM-only, small or I/D)
    out.push({ name, locality: String(r[cLocality] ?? '').trim(), median, p40, students });
  }
  if (out.length < 300) throw new Error(`SSCAI ${year}: only ${out.length} schools parsed`);
  for (const s of out) {
    if (s.median < 10 || s.median > 50 || (s.p40 !== null && (s.p40 < 0 || s.p40 > 100))) throw new Error(`SSCAI ${year}: bad row ${JSON.stringify(s)}`);
  }
  return out;
}

async function buildSchools() {
  const byKey = new Map();
  for (const y of SSCAI_YEARS) {
    for (const s of await parseSscai(y)) {
      const key = `${s.name.toLowerCase()}|${s.locality.toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, { name: s.name, locality: s.locality, years: {} });
      const e = byKey.get(key);
      e.name = s.name;
      e.years[y] = [s.median, s.p40, s.students];
    }
  }
  const latest = SSCAI_YEARS.at(-1);
  // Keep schools with results in the latest year; older years only refine the average.
  return [...byKey.values()].filter((s) => s.years[latest]).sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const scaling = {};
  const atar = {};
  for (const y of VTAC_YEARS) {
    scaling[y] = await parseScaling(y);
    atar[y] = await parseAtar(y);
    console.log(`VTAC ${y}: ${scaling[y].length} studies, ${atar[y].length} ATAR rows`);
  }
  const gas = await parseGradeDistributions();
  console.log(`VCAA ${GA_YEAR}: ${gas.length} grade distribution files`);
  const weights = await parseWeights();
  console.log(`VCAA weights: ${weights.length} studies`);

  const meta = {
    generated: new Date().toISOString().slice(0, 10),
    sources: {
      scaling: Object.fromEntries(VTAC_FILES_URLS('scaling')),
      atar: Object.fromEntries(VTAC_FILES_URLS('atar')),
      gradeDistributions: `https://www.vcaa.vic.edu.au/administration/school-administration/performance-senior-secondary/${GA_YEAR}-grade-distributions-vce-graded-assessments`,
      weights: 'https://www.vcaa.vic.edu.au/administration/vce-administrative-handbook/vce-and-vet-assessment-summary',
    },
    gaYear: GA_YEAR,
  };

  const { studies, smallLote, unmatchedGa } = buildCatalogue(scaling, gas, weights);
  if (unmatchedGa.length) console.log(`catalogue: unmatched VCAA files: ${unmatchedGa.join(', ')}`);
  console.log(`catalogue: ${studies.length} studies, ${studies.filter((s) => s.assessment).length} with study score data`);

  const schools = await buildSchools();
  console.log(`VCAA SSCAI ${SSCAI_YEARS.join('/')}: ${schools.length} schools`);

  await writeFile(join(OUT, 'studies.json'), JSON.stringify({ meta, smallLote, studies }) + '\n');
  await writeFile(
    join(OUT, 'schools.json'),
    JSON.stringify({ source: SSCAI_PAGE, years: SSCAI_YEARS, fields: ['median', 'p40', 'students'], schools }) + '\n',
  );
  await writeFile(join(OUT, 'atar.json'), JSON.stringify({ meta, years: atar }) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
