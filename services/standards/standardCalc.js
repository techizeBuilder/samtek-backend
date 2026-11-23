// Feature 19 (client, 20 Nov 2026): standard hours — the maths, pure (no database).
// docs/client-features-2026-11/19-standard-hours-logic.md §3–§4 (decisions A–H, 21 Nov).
//
// A step's standard for n pieces with k people:
//   standard(n, k) = setup + n × p1 × ( σ + (1 − σ) ÷ k )        (Amdahl's rule)
// p1 = hours per piece for ONE person = R&D's hours per piece ÷ ( σ + (1 − σ) ÷ R&D's crew )
// σ = the share of the work that doesn't split across people, from R&D's answer to
// "Do more people make this step faster?". Setup counts once and doesn't shrink.

const H = 3600 * 1000;

/** R&D's answer → σ. */
export const SIGMA = Object.freeze({ Yes: 0.1, Partly: 0.3, Hardly: 0.6, No: 1 });
export const SPLIT_ANSWERS = Object.freeze(Object.keys(SIGMA));
/** σ for an answer; no answer counts as "Partly" (cautious: more people help, but not fully). */
export const sigmaOf = (answer) => (Object.prototype.hasOwnProperty.call(SIGMA, answer) ? SIGMA[answer] : SIGMA.Partly);

/** Time with k people as a share of the time with 1 person. */
export const crewFactor = (sigma, k) => {
  const s = Math.min(1, Math.max(0, Number(sigma) || 0));
  return s + (1 - s) / Math.max(1, Number(k) || 1);
};

/** Hours per piece for one person, from R&D's hours per piece with their crew. null when not typed. */
export function perPieceFor1({ hoursPerPiece, crew = 1, sigma }) {
  const h = Number(hoursPerPiece);
  if (!(h > 0)) return null;
  return h / crewFactor(sigma, Math.max(1, Number(crew) || 1));
}

/** A standard's working values from R&D's numbers: { p1, setup, sigma, crew } (or null). */
export function standardFrom({ hoursPerPiece, crew, setupHours, splitAnswer }) {
  const sigma = sigmaOf(splitAnswer);
  const c = Math.max(1, Math.round(Number(crew) || 1));
  const p1 = perPieceFor1({ hoursPerPiece, crew: c, sigma });
  if (p1 == null) return null;
  return { p1, setup: Math.max(0, Number(setupHours) || 0), sigma, crew: c };
}

/** Standard hours for n pieces with k people. null when unknown. */
export function standardHours(std, n, k) {
  if (!std || !(Number(std.p1) > 0) || !(Number(n) > 0) || !(Number(k) >= 1)) return null;
  return (Number(std.setup) || 0) + Number(n) * Number(std.p1) * crewFactor(std.sigma, k);
}

/**
 * The crew over time, from each person's present intervals ([startMs, endMs], as
 * crewHoursCalc.personStepHours gives them in days[].intervals): stretches with how
 * many people were working at once. [{ hours, k }], in time order, same-k neighbours merged.
 */
export function crewSegments(perPerson = []) {
  const ev = [];
  for (const p of perPerson || []) {
    for (const d of p.days || []) {
      for (const iv of d.intervals || []) {
        const a = Number(iv[0]), b = Number(iv[1]);
        if (b > a) { ev.push([a, 1]); ev.push([b, -1]); }
      }
    }
  }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]); // an end before a start at the same moment
  const out = [];
  let k = 0, last = null;
  for (const [t, d] of ev) {
    if (last != null && k > 0 && t > last) {
      const hours = (t - last) / H;
      const prev = out[out.length - 1];
      if (prev && prev.k === k) prev.hours += hours; else out.push({ hours, k });
    }
    k += d;
    last = t;
  }
  return out;
}

/**
 * The standard a run earned when its crew changed: each stretch with k people did
 * hours ÷ standard(n, k) of the work; earned = hours it took ÷ the share done (§3.4).
 * With one crew all through, that's standard(n, k).
 */
export function earnedHours(segments = [], std, n) {
  let took = 0, share = 0;
  for (const s of segments) {
    const t = standardHours(std, n, s.k);
    if (!(t > 0) || !(s.hours > 0)) continue;
    took += s.hours;
    share += s.hours / t;
  }
  if (!(took > 0) || !(share > 0)) return null;
  return took / share;
}

/** What one finished run says a piece takes one person: (took − setup) ÷ (pieces × crew factor). */
export function observedP1(run, std) {
  const took = Number(run?.workingHours), n = Number(run?.pieces), k = Number(run?.crewSize) || 1;
  if (!(took > 0) || !(n > 0)) return null;
  const work = took - (Number(std?.setup) || 0);
  if (!(work > 0)) return null;
  return work / (n * crewFactor(std?.sigma ?? SIGMA.Partly, k));
}

/** The middle one. */
export function median(values = []) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const CREDIBILITY = 3; // history counts half at 3 runs, three quarters at 10
export const MIN_RUNS = 3;

/**
 * History's proposal for p1 (§3.5): the median of the last 10 non-rework runs, blended
 * with the current figure by how many runs there are — (3 × current + N × history) ÷ (3 + N).
 * null below MIN_RUNS runs. { p1, historyP1, runs }
 */
export function proposal(runs = [], std) {
  const recent = (runs || []).filter((r) => !r.rework && r.pieces > 0 && r.workingHours > 0)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).slice(0, 10);
  const obs = recent.map((r) => observedP1(r, std)).filter((x) => x != null);
  if (obs.length < MIN_RUNS || !(Number(std?.p1) > 0)) return null;
  const h = median(obs);
  const p1 = (CREDIBILITY * Number(std.p1) + obs.length * h) / (CREDIBILITY + obs.length);
  return { p1, historyP1: h, runs: obs.length };
}

/**
 * σ measured from the runs themselves, when they cover at least 2 crew sizes with 3+
 * runs each: least squares of (took − setup) ÷ pieces against 1 ÷ crew → a + b/k, σ = a ÷ (a + b).
 * null with too little spread, or a result outside 0…1.
 */
export function fitSigma(runs = [], setup = 0) {
  const rows = (runs || []).filter((r) => !r.rework && r.pieces > 0 && r.workingHours > 0 && r.crewSize >= 1)
    .map((r) => ({ x: 1 / r.crewSize, y: (r.workingHours - (Number(setup) || 0)) / r.pieces, k: r.crewSize }))
    .filter((r) => r.y > 0);
  const byK = new Map();
  for (const r of rows) byK.set(r.k, (byK.get(r.k) || 0) + 1);
  if ([...byK.values()].filter((c) => c >= 3).length < 2) return null;
  const n = rows.length;
  const mx = rows.reduce((t, r) => t + r.x, 0) / n, my = rows.reduce((t, r) => t + r.y, 0) / n;
  const sxx = rows.reduce((t, r) => t + (r.x - mx) ** 2, 0);
  if (!(sxx > 0)) return null;
  const b = rows.reduce((t, r) => t + (r.x - mx) * (r.y - my), 0) / sxx;
  const a = my - b * mx;
  if (!(a + b > 0)) return null;
  const s = a / (a + b);
  return s >= 0 && s <= 1 ? s : null;
}

/**
 * The planned hours a step is scored against (decisions D, G, H; §5):
 *   - typed (no approved standard when it started) → not scored (H)
 *   - a flag waiting for the Company Admin → not scored yet (D: only its score waits)
 *   - a flag approved → the hours Production asked for
 *   - the standard (or a flag rejected) → the standard it earned
 *   - started before standards existed (no source) → its typed hours, as before (G)
 * { planned, counted, why } — why: 'typed' | 'flagWaiting' | 'flagApproved' | 'standard' | 'legacy'.
 */
export function scoredPlan({ plannedSource = null, plannedHours = null, earned = null, flag = null } = {}) {
  if (plannedSource === 'typed') return { planned: null, counted: false, why: 'typed' };
  if (plannedSource === 'standard') {
    if (flag?.status === 'Pending') return { planned: null, counted: false, why: 'flagWaiting' };
    if (flag?.status === 'Approved' && Number(flag.requestedHours) > 0) return { planned: Number(flag.requestedHours), counted: true, why: 'flagApproved' };
    const h = Number(earned) > 0 ? Number(earned) : Number(plannedHours);
    return h > 0 ? { planned: h, counted: true, why: 'standard' } : { planned: null, counted: false, why: 'standard' };
  }
  const h = Number(plannedHours);
  return h > 0 ? { planned: h, counted: true, why: 'legacy' } : { planned: null, counted: false, why: 'legacy' };
}
