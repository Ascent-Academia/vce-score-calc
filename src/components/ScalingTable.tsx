import { useMemo, useState } from 'react';
import { META, STUDIES, YEARS, scalingPoints, type Study } from '../lib/data';
import { scaledScore } from '../lib/scaling';

type SortKey = 'name' | 'mean' | 's30' | 's40' | 'change';

const POINTS = [20, 25, 30, 35, 40, 45, 50];

export function ScalingTable({ year }: { year: number }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('s30');
  const [desc, setDesc] = useState(true);
  const [lookup, setLookup] = useState('35');
  const prevYear = YEARS.find((y) => y < year);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STUDIES.map((s) => {
      const pts = scalingPoints(s, year);
      const row = s.scaling[year];
      // Year-on-year change only when both years were scaled on their own (not as a small study).
      const prevRow = prevYear ? s.scaling[prevYear] : null;
      const prev = prevYear && prevRow && prevRow !== 'small' && row !== 'small' ? scalingPoints(s, prevYear) : null;
      return { s, pts, mean: row && row !== 'small' ? row.mean : null, small: row === 'small', change: pts && prev ? pts[2] - prev[2] : null };
    })
      .filter((r) => r.pts && (!q || r.s.name.toLowerCase().includes(q)))
      .sort((a, b) => {
        const v = (r: typeof a) => (sort === 'name' ? r.s.name : sort === 'mean' ? (r.mean ?? -1) : sort === 's30' ? r.pts![2] : sort === 's40' ? r.pts![4] : (r.change ?? -99));
        const x = v(a);
        const y = v(b);
        const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
        return (desc ? -c : c) || a.s.name.localeCompare(b.s.name);
      });
  }, [query, sort, desc, year, prevYear]);

  const sortButton = (key: SortKey, label: string) => (
      <button
        type="button"
        className="sort"
        onClick={() => {
          if (sort === key) setDesc(!desc);
          else {
            setSort(key);
            setDesc(key !== 'name');
          }
        }}
      >
        {label}
        {sort === key ? (desc ? ' ↓' : ' ↑') : ''}
      </button>
  );
  const th = (key: SortKey, label: string) => (
    <th aria-sort={sort === key ? (desc ? 'descending' : 'ascending') : 'none'}>{sortButton(key, label)}</th>
  );

  const ss = Math.max(0, Math.min(50, Number(lookup) || 0));

  return (
    <section className="card">
      <header className="card-head">
        <h2>VTAC scaling, {year}</h2>
        <p className="muted">
          Scaled scores for study scores of 20–50, from the{' '}
          <a href={META.sources.scaling[year]} target="_blank" rel="noreferrer">
            VTAC {year} Scaling Report
          </a>
          . The last column interpolates your study score.
        </p>
      </header>
      <div className="toolbar">
        <input type="search" placeholder="Filter studies…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter studies" />
        <label className="inline">
          Study score
          <input type="number" min={0} max={50} value={lookup} onChange={(e) => setLookup(e.target.value)} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="scaling">
          <thead>
            <tr>
              {th('name', 'Study')}
              {th('mean', 'Mean')}
              {POINTS.map((p) => (p === 30 ? <th key={p} className="num">{sortButton('s30', '30')}</th> : p === 40 ? <th key={p} className="num">{sortButton('s40', '40')}</th> : <th key={p} className="num">{p}</th>))}
              {prevYear && th('change', `Δ30 vs ${prevYear}`)}
              <th>{ss} →</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, pts, mean, small, change }) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  {small && <small className="muted"> · small study (All small LOTEs)</small>}
                </td>
                <td className="num">{mean?.toFixed(1) ?? '–'}</td>
                {pts!.map((v, i) => (
                  <td key={i} className={`num ${cls(v, POINTS[i])}`}>
                    {v}
                  </td>
                ))}
                {prevYear && <td className={`num ${change! > 0 ? 'up' : change! < 0 ? 'down' : ''}`}>{change == null ? '–' : change > 0 ? `+${change}` : change}</td>}
                <td className="num strong">{scaledScore(s as Study, ss, year)?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function cls(scaled: number, raw: number) {
  const d = scaled - raw;
  return d >= 3 ? 'up2' : d >= 1 ? 'up1' : d <= -3 ? 'down2' : d <= -1 ? 'down1' : '';
}
