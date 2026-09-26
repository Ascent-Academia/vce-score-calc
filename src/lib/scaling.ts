// Study score -> VTAC scaled study score.
//
// VTAC publishes scaled scores (rounded to integers) at study scores 20, 25, ..., 50.
// We interpolate with a monotone cubic Hermite spline (Fritsch–Carlson / PCHIP) and
// extend it linearly below 20 using the spline's slope at 20. Checked against the
// 23 two-decimal scaled scores printed in VTAC's ATAR and Scaling Guide examples
// (2021–2023): mean absolute error 0.20, max 0.53 (see scaling.test.ts).
import { scalingPoints, type Study } from './data';

const KNOTS = [20, 25, 30, 35, 40, 45, 50];

/** PCHIP end-point and interior slopes (Fritsch–Carlson with the SciPy end condition). */
function pchipSlopes(x: number[], y: number[]): number[] {
  const n = x.length;
  const h = x.slice(1).map((v, i) => v - x[i]);
  const delta = h.map((hi, i) => (y[i + 1] - y[i]) / hi);
  const m: number[] = Array.from({ length: n }, () => 0);
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  const end = (h0: number, h1: number, d0: number, d1: number) => {
    let d = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(d) !== Math.sign(d0)) d = 0;
    else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(d) > Math.abs(3 * d0)) d = 3 * d0;
    return d;
  };
  m[0] = end(h[0], h[1], delta[0], delta[1]);
  m[n - 1] = end(h[n - 2], h[n - 3], delta[n - 2], delta[n - 3]);
  return m;
}

export function interpolateScaled(points: number[], studyScore: number): number {
  const x = KNOTS;
  const m = pchipSlopes(x, points);
  const s = Math.max(0, Math.min(50, studyScore));
  if (s <= x[0]) return Math.max(0, points[0] + m[0] * (s - x[0]));
  let i = 0;
  while (i < x.length - 2 && s > x[i + 1]) i++;
  const h = x[i + 1] - x[i];
  const t = (s - x[i]) / h;
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
  const h10 = t ** 3 - 2 * t ** 2 + t;
  const h01 = -2 * t ** 3 + 3 * t ** 2;
  const h11 = t ** 3 - t ** 2;
  return h00 * points[i] + h10 * h * m[i] + h01 * points[i + 1] + h11 * h * m[i + 1];
}

/** Scaled study score (2 d.p., as VTAC uses in aggregation), or null if no data for the year. */
export function scaledScore(study: Study, studyScore: number, year: number): number | null {
  const pts = scalingPoints(study, year);
  if (!pts) return null;
  return Math.round(interpolateScaled(pts, studyScore) * 100) / 100;
}
