import { useEffect, useState } from 'react';
import { AtarCalculator, newUid, type SubjectRow } from './components/AtarCalculator';
import { StudyScoreCalculator } from './components/StudyScoreCalculator';
import { ScalingTable } from './components/ScalingTable';
import { Methodology } from './components/Methodology';
import { LATEST_YEAR, YEARS, getStudy } from './lib/data';
import type { ExtraIncrements } from './lib/atar';

type Tab = 'atar' | 'study' | 'scaling' | 'method';
const TABS: { id: Tab; label: string }[] = [
  { id: 'atar', label: 'ATAR' },
  { id: 'study', label: 'Study score' },
  { id: 'scaling', label: 'Scaling' },
  { id: 'method', label: 'Method & sources' },
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
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <path d="M8 22l5-6 4 3 7-9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <h1>VCE Study Score &amp; ATAR Calculator</h1>
            <p className="muted">Built on official VCAA and VTAC data</p>
          </div>
        </div>
        <div className="top-controls">
          <label className="inline">
            Data year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                  {y === LATEST_YEAR ? ' (latest)' : ''}
                </option>
              ))}
            </select>
          </label>
          {tab === 'atar' && (
            <button type="button" className="secondary" onClick={share}>
              {copied ? 'Link copied' : 'Share'}
            </button>
          )}
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Calculator sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

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
        Estimates only; not affiliated with VCAA or VTAC. Official results come from VCAA (study scores) and VTAC (ATAR).
      </footer>
    </div>
  );
}
