import { useMemo } from 'react';
import { STUDIES, getStudy, LATEST_YEAR } from '../lib/data';
import { aggregateToAtar, atarToAggregate, calculateAggregate, higherEducationIncrement, type ExtraIncrements } from '../lib/atar';
import { StudyPicker } from './StudyPicker';

export interface SubjectRow {
  uid: string;
  studyId: string | null;
  studyScore: string;
}

interface Props {
  year: number;
  rows: SubjectRow[];
  setRows: (rows: SubjectRow[]) => void;
  extras: ExtraIncrements;
  setExtras: (e: ExtraIncrements) => void;
  onEstimate: (studyId: string | null, uid: string) => void;
}

const fmt = (v: number | undefined | null, d = 2) => (v == null ? '–' : v.toFixed(d));
export const newUid = () => Math.random().toString(36).slice(2, 9);

export function AtarCalculator({ year, rows, setRows, extras, setExtras, onEstimate }: Props) {
  const entries = rows
    .filter((r) => r.studyId && r.studyScore !== '' && Number.isFinite(Number(r.studyScore)))
    .map((r) => ({ studyId: r.studyId!, studyScore: Math.max(0, Math.min(50, Number(r.studyScore))), uid: r.uid }));

  const result = useMemo(() => calculateAggregate(entries, year, extras), [JSON.stringify(entries), year, extras]); // eslint-disable-line react-hooks/exhaustive-deps
  const atar = result.eligible ? aggregateToAtar(result.aggregate, year) : null;
  const byUid = new Map(result.rows.filter((r) => r.key.startsWith('s')).map((r) => [entries[Number(r.key.slice(1))]?.uid, r]));
  const extraRows = result.rows.filter((r) => !r.key.startsWith('s') && r.role !== 'unused');

  const update = (uid: string, patch: Partial<SubjectRow>) => setRows(rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const remove = (uid: string) => setRows(rows.filter((r) => r.uid !== uid));
  const add = () => setRows([...rows, { uid: newUid(), studyId: null, studyScore: '' }]);

  const next = atar?.atar != null && atar.atar < 99.95 ? nextMilestone(atar.atar) : null;
  const needed = next != null ? atarToAggregate(next, year) : null;

  return (
    <div className="grid-2">
      <section className="card">
        <header className="card-head">
          <h2>Your studies</h2>
          <p className="muted">Enter an actual or expected study score for each Unit 3–4 study. Don't know it yet? Use <strong>Estimate</strong>.</p>
        </header>
        <div className="subject-table" role="table" aria-label="Studies">
          <div className="subject-row head" role="row">
            <span role="columnheader">Study</span>
            <span role="columnheader">Study score</span>
            <span role="columnheader">Scaled</span>
            <span role="columnheader">Counts</span>
            <span />
          </div>
          {rows.map((r) => {
            const res = byUid.get(r.uid);
            const study = r.studyId ? getStudy(r.studyId) : undefined;
            return (
              <div className="subject-row" role="row" key={r.uid}>
                <span role="cell">
                  <StudyPicker label="Study" studies={STUDIES} value={r.studyId} onChange={(id) => update(r.uid, { studyId: id })} />
                </span>
                <span role="cell" className="score-cell">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={50}
                    aria-label={`Study score${study ? ` for ${study.name}` : ''}`}
                    value={r.studyScore}
                    placeholder="0–50"
                    onChange={(e) => update(r.uid, { studyScore: e.target.value })}
                  />
                  <button type="button" className="link" disabled={!study?.assessment} title={study && !study.assessment ? 'No VCAA grade distribution for this study' : 'Estimate from SAC and exam results'} onClick={() => onEstimate(r.studyId, r.uid)}>
                    Estimate
                  </button>
                </span>
                <span role="cell" className="num">
                  {fmt(res?.scaled)}
                  {res?.scalingYear && res.scalingYear !== year && <small className="muted"> ({res.scalingYear})</small>}
                </span>
                <span role="cell">
                  {res ? (
                    <span className={`badge ${res.role}`} title={res.note}>
                      {res.role === 'primary' ? `Primary · ${fmt(res.contribution)}` : res.role === 'increment' ? `10% · ${fmt(res.contribution)}` : 'Not counted'}
                    </span>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </span>
                <span role="cell">
                  <button type="button" className="icon" aria-label="Remove study" onClick={() => remove(r.uid)}>
                    ×
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <button type="button" className="glass-btn" onClick={add}>
          + Add study
        </button>

        <details className="extras">
          <summary>Other increments (non-scored VET, higher education study)</summary>
          <div className="extras-grid">
            <label>
              Non-scored VCE VET / VE3 sequences
              <select value={extras.nonScoredVet ?? 0} onChange={(e) => setExtras({ ...extras, nonScoredVet: Number(e.target.value) })}>
                <option value={0}>None</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
              <small className="muted">Each is worth 10% of your 4th primary score.</small>
            </label>
            <label>
              Higher education study average mark (%)
              <input
                type="number"
                min={0}
                max={100}
                value={extras.higherEducationMark ?? ''}
                placeholder="None"
                onChange={(e) => setExtras({ ...extras, higherEducationMark: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <small className="muted">Increment: {higherEducationIncrement(extras.higherEducationMark).toFixed(1)} (5.0 for 90+, down to 3.0 for 50–59).</small>
            </label>
          </div>
        </details>
      </section>

      {entries.length > 0 && (
        <div className="mobile-bar glass" aria-hidden="true">
          <span>ATAR</span>
          <strong>{atar ? (atar.below30 ? '< 30' : atar.atar!.toFixed(2)) : '—'}</strong>
          <span>Aggregate {result.eligible ? result.aggregate.toFixed(2) : '–'}</span>
        </div>
      )}
      <aside className="card result glass" aria-live="polite">
        <p className="eyebrow">Estimated ATAR · {year} tables{year === LATEST_YEAR ? ' (latest)' : ''}</p>
        <p className="atar">{atar ? (atar.below30 ? '< 30' : atar.atar!.toFixed(2)) : '—'}</p>
        {!result.eligible && <p className="muted">{entries.length === 0 ? 'Add your studies to see your ATAR.' : result.reason}</p>}
        <dl className="stats">
          <div>
            <dt>Aggregate</dt>
            <dd>{result.eligible ? result.aggregate.toFixed(2) : '–'}</dd>
          </div>
          <div>
            <dt>Primary four</dt>
            <dd>{fmt(result.rows.filter((r) => r.role === 'primary').reduce((s, r) => s + r.contribution, 0) || null)}</dd>
          </div>
          <div>
            <dt>Increments</dt>
            <dd>{fmt(result.rows.filter((r) => r.role === 'increment').reduce((s, r) => s + r.contribution, 0) || null)}</dd>
          </div>
        </dl>
        {extraRows.length > 0 && (
          <ul className="plain small">
            {extraRows.map((r) => (
              <li key={r.key}>
                {r.label}: +{r.contribution.toFixed(2)}
              </li>
            ))}
          </ul>
        )}
        {needed != null && result.eligible && (
          <p className="hint">
            {(needed - result.aggregate).toFixed(2)} more aggregate points would reach an ATAR of <strong>{next!.toFixed(2)}</strong> ({needed.toFixed(2)}).
          </p>
        )}
        <p className="fineprint">
          Scaling: VTAC {year} scaling report. Aggregate → ATAR: VTAC {year} aggregate-to-ATAR table. Future years will differ slightly.
        </p>
      </aside>
    </div>
  );
}

function nextMilestone(atar: number): number {
  const marks = [50, 60, 70, 75, 80, 85, 90, 92, 94, 95, 96, 97, 98, 99, 99.5, 99.9, 99.95];
  return marks.find((m) => m > atar + 1e-9) ?? 99.95;
}
