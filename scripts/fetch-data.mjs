// Downloads the official VTAC and VCAA source files into data/raw/.
// Run `npm run data:fetch`, then `npm run data:build` to regenerate src/data/*.json.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { VTAC_FILES, GA_YEAR } from './sources.mjs';

const RAW = new URL('../data/raw/', import.meta.url).pathname;
const VTAC = 'https://vtac.edu.au/files/pdf/reports';
const VCAA = 'https://www.vcaa.vic.edu.au';


const force = process.argv.includes('--force');

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  if (!force && (await exists(dest))) return 'cached';
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (vce-score-calc data fetcher)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return 'downloaded';
    } catch (err) {
      if (attempt === 4) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function main() {
  await mkdir(join(RAW, 'vtac'), { recursive: true });
  await mkdir(join(RAW, 'vcaa', `ga${GA_YEAR}`), { recursive: true });

  const jobs = [];
  for (const [y, f] of Object.entries(VTAC_FILES)) {
    jobs.push([`${VTAC}/${f.scaling}`, join(RAW, 'vtac', `scaling-report-${y}.pdf`)]);
    jobs.push([`${VTAC}/${f.atar}`, join(RAW, 'vtac', `atar-to-aggregate-${y}.pdf`)]);
  }

  // VCAA assessment summary page (graded assessment contributions to study scores).
  jobs.push([
    `${VCAA}/administration/vce-administrative-handbook/vce-and-vet-assessment-summary`,
    join(RAW, 'vcaa', 'assessment-summary.html'),
  ]);

  // VCAA grade distribution index page, then one PDF per study.
  const indexUrl = `${VCAA}/administration/school-administration/performance-senior-secondary/${GA_YEAR}-grade-distributions-vce-graded-assessments`;
  const indexPath = join(RAW, 'vcaa', `ga${GA_YEAR}-index.html`);
  await download(indexUrl, indexPath);
  const html = await (await import('node:fs/promises')).readFile(indexPath, 'utf8');
  const suffix = `_ga${String(GA_YEAR).slice(2)}.pdf`;
  const links = [...new Set([...html.matchAll(/href="([^"]+\.pdf)"/g)].map((m) => m[1]))].filter((h) =>
    h.endsWith(suffix),
  );
  if (links.length === 0) throw new Error('No grade distribution PDFs found on the VCAA index page');
  for (const href of links) {
    const file = decodeURIComponent(href.split('/').pop());
    jobs.push([new URL(href, VCAA).href, join(RAW, 'vcaa', `ga${GA_YEAR}`, file)]);
  }

  let done = 0;
  const queue = [...jobs];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const [url, dest] = queue.shift();
      const status = await download(url, dest);
      done++;
      if (status === 'downloaded') console.log(`[${done}/${jobs.length}] ${url}`);
    }
  });
  await Promise.all(workers);
  console.log(`Done: ${jobs.length} files in ${RAW}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
