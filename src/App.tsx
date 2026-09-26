import { useEffect, useState } from 'react';
import logo from './assets/ascent-logo.svg?raw';
import mark from './assets/ascent-mark.svg?raw';
import { AtarCalculator, newUid, type SubjectRow } from './components/AtarCalculator';
import { StudyScoreCalculator } from './components/StudyScoreCalculator';
import { ScalingTable } from './components/ScalingTable';
import { Methodology } from './components/Methodology';
import { GlassSelect } from './components/GlassSelect';
import { TabBar } from './components/TabBar';
import { LATEST_YEAR, YEARS, getStudy } from './lib/data';
import type { ExtraIncrements } from './lib/atar';

type Tab = 'atar' | 'study' | 'scaling' | 'method';
const TABS: { id: Tab; label: string; short: string }[] = [
  { id: 'atar', label: 'ATAR', short: 'ATAR' },
  { id: 'study', label: 'Study score', short: 'Study score' },
  { id: 'scaling', label: 'Scaling', short: 'Scaling' },
  { id: 'method', label: 'Method & sources', short: 'Method' },
];

const STORAGE_KEY = 'vce-score-calc:v1';

interface Saved {
  year: number;
  rows: SubjectRow[];
  extras: ExtraIncrements;
}

// Example set shown on first visit.
const DEFAULT_ROWS: SubjectRow[] = [
  ['EN', '32'],
  ['NJ', '35'],
  ['CH', '33'],
  ['PY', '34'],
  ['BI', '31'],
  ['LS', '30'],
].map(([id, score]) => ({ uid: newUid(), studyId: id, studyScore: score }));

function load(): Saved {
  // A shared link (#s=...) takes precedence over what's saved in this browser.
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('s');
  if (fromHash) {
    const rows = fromHash.split(',').map((p) => {
      const [id, score] = p.split(':');
      return { uid: newUid(), studyId: getStudy(id) ? id : null, studyScore: score ?? '' };
    });
    return { year: LATEST_YEAR, rows, extras: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (Array.isArray(s.rows)) return { year: YEARS.includes(s.year) ? s.year : LATEST_YEAR, rows: s.rows, extras: s.extras ?? {} };
    }
  } catch {
    /* storage unavailable */
  }
  return { year: LATEST_YEAR, rows: DEFAULT_ROWS, extras: {} };
}

export default function App() {
  const [initial] = useState(load);
  const [tab, setTab] = useState<Tab>('atar');
  const [year, setYear] = useState(initial.year);
  const [rows, setRows] = useState<SubjectRow[]>(initial.rows);
  const [extras, setExtras] = useState<ExtraIncrements>(initial.extras);
  const [estimateFor, setEstimateFor] = useState<{ studyId: string | null; uid: string | null }>({ studyId: 'NJ', uid: null });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ year, rows, extras }));
    } catch {
      /* storage unavailable */
    }
  }, [year, rows, extras]);

  const share = async () => {
    const s = rows.filter((r) => r.studyId).map((r) => `${r.studyId}:${r.studyScore}`).join(',');
    const url = `${location.origin}${location.pathname}#s=${s}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      location.hash = `s=${s}`;
    }
  };

  const useEstimate = (studyId: string, score: number) => {
    const target = rows.find((r) => r.uid === estimateFor.uid) ?? rows.find((r) => r.studyId === studyId) ?? rows.find((r) => !r.studyId);
    if (target) setRows(rows.map((r) => (r === target ? { ...r, studyId, studyScore: String(score) } : r)));
    else setRows([...rows, { uid: newUid(), studyId, studyScore: String(score) }]);
    setEstimateFor({ studyId, uid: null });
    setTab('atar');
  };

  return (
    <div className="app">
      <div className="backdrop" aria-hidden="true">
        <span className="orb orb-1" />
        <span className="orb orb-2" />
        <span className="orb orb-3" />
      </div>

      <header className="top glass">
        <a className="brand" href="https://ascentacademia.com.au/" target="_blank" rel="noreferrer" aria-label="Ascent Academia website">
          <span className="logo" dangerouslySetInnerHTML={{ __html: logo }} />
        </a>
        <div className="brand-title">
          <h1>VCE ATAR &amp; Study Score Calculator</h1>
          <p>Built on official VCAA and VTAC data</p>
        </div>
        <div className="top-controls">
          <GlassSelect
            label="Data year"
            value={year}
            onChange={setYear}
            options={YEARS.map((y) => ({ value: y, label: String(y), hint: y === LATEST_YEAR ? 'Latest' : undefined }))}
          />
          {tab === 'atar' && (
            <button type="button" className="glass-btn" onClick={share}>
              {copied ? 'Link copied' : 'Share'}
            </button>
          )}
        </div>
      </header>

      <TabBar tabs={TABS} value={tab} onChange={setTab} />

      <main>
        {tab === 'atar' && (
          <AtarCalculator
            year={year}
            rows={rows}
            setRows={setRows}
            extras={extras}
            setExtras={setExtras}
            onEstimate={(studyId, uid) => {
              setEstimateFor({ studyId, uid });
              setTab('study');
            }}
          />
        )}
        {tab === 'study' && (
          <StudyScoreCalculator
            year={year}
            studyId={estimateFor.studyId}
            setStudyId={(id) => setEstimateFor({ studyId: id, uid: estimateFor.uid && rows.find((r) => r.uid === estimateFor.uid)?.studyId === id ? estimateFor.uid : null })}
            onUse={useEstimate}
            useLabel={estimateFor.uid ? 'Use in ATAR calculator' : 'Add to ATAR calculator'}
          />
        )}
        {tab === 'scaling' && <ScalingTable year={year} />}
        {tab === 'method' && <Methodology />}
      </main>

      <footer className="foot">
        <span className="foot-mark" dangerouslySetInnerHTML={{ __html: mark }} />
        <span>
          © {new Date().getFullYear()} <a href="https://ascentacademia.com.au/" target="_blank" rel="noreferrer">Ascent Academia</a>. Estimates only; not affiliated with VCAA or VTAC. Official results come from VCAA (study scores) and VTAC (ATAR).
        </span>
      </footer>
    </div>
  );
}
