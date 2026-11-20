// Stage 5 (2026-11-12): hours a crew really worked on a step, and the average
// time per step. Pure: no database, so the worked examples in
// docs/client-features-2026-11/02e-assign-and-hours-logic.md test it directly.
//
// A person's hours on a step = where these overlap: their time on the crew, the
// step running, and their presence from the attendance punches — minus lunch.
// Lunch comes from the day's shift (the one whose start is nearest the punch-in)
// unless Production said they took it later or not at all.

const IST_MS = 5.5 * 3600 * 1000;
const DAY_MIN = 1440;
const H = 3600 * 1000;

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
};
const indiaMinuteOfDay = (d) => { const t = new Date(new Date(d).getTime() + IST_MS); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
// Midnight (India) of the India date that `d` falls on, as a Date.
const indiaMidnight = (d) => { const t = new Date(new Date(d).getTime() + IST_MS); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - IST_MS); };
export const indiaDateOf = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const mod = (n) => ((n % DAY_MIN) + DAY_MIN) % DAY_MIN;

// ─── Intervals: [start, end] in ms ───
const clip = (a, b) => { const s = Math.max(a[0], b[0]), e = Math.min(a[1], b[1]); return e > s ? [s, e] : null; };
const len = (iv) => (iv ? iv[1] - iv[0] : 0);
const minus = (a, b) => { // a without b → up to two pieces
  const c = clip(a, b);
  if (!c) return [a];
  const out = [];
  if (c[0] > a[0]) out.push([a[0], c[0]]);
  if (c[1] < a[1]) out.push([c[1], a[1]]);
  return out;
};
const unionLength = (list) => {
  const s = [...list].sort((x, y) => x[0] - y[0]);
  let total = 0, cur = null;
  for (const iv of s) {
    if (!cur || iv[0] > cur[1]) { if (cur) total += len(cur); cur = [...iv]; } else cur[1] = Math.max(cur[1], iv[1]);
  }
  return total + len(cur);
};

/**
 * The day's shift: the one whose start is nearest the punch-in, counting round
 * the clock (a 21:50 punch-in is 10 minutes from a 22:00 start). A tie takes the
 * shift that starts earlier in the day. Returns the shift with its real start,
 * end and usual lunch as Dates, or null when no shifts are set.
 */
export function shiftForDay(punchIn, shifts = []) {
  const valid = (shifts || []).filter((s) => toMin(s.start) !== null && toMin(s.end) !== null);
  if (!punchIn || !valid.length) return null;
  const p = indiaMinuteOfDay(punchIn);
  let best = null;
  for (const s of [...valid].sort((a, b) => toMin(a.start) - toMin(b.start))) {
    const diff = Math.abs(p - toMin(s.start));
    const dist = Math.min(diff, DAY_MIN - diff);
    if (!best || dist < best.dist) best = { s, dist };
  }
  const s = best.s, startMin = toMin(s.start);
  // The occurrence of the start time nearest the punch-in: yesterday, today or tomorrow.
  const mid = indiaMidnight(punchIn).getTime();
  const start = [-1, 0, 1].map((k) => mid + k * DAY_MIN * 60000 + startMin * 60000)
    .reduce((a, b) => (Math.abs(b - new Date(punchIn).getTime()) < Math.abs(a - new Date(punchIn).getTime()) ? b : a));
  const lengthMin = mod(toMin(s.end) - startMin) || DAY_MIN;
  const at = (hhmm) => start + mod(toMin(hhmm) - startMin) * 60000; // a time of day inside this shift
  const lunch = toMin(s.lunchFrom) !== null && toMin(s.lunchTo) !== null
    ? [at(s.lunchFrom), at(s.lunchFrom) + (mod(toMin(s.lunchTo) - toMin(s.lunchFrom)) * 60000)]
    : null;
  return { name: s.name, start, end: start + lengthMin * 60000, lunch, at };
}

/**
 * A shift's working hours: end − start − its usual lunch (stage 6, the hourly
 * rate's divisor). No shift (none set by HR) → 8.
 */
export function shiftHoursOf(shift) {
  if (!shift) return 8;
  const lunch = shift.lunch ? shift.lunch[1] - shift.lunch[0] : 0;
  const h = (shift.end - shift.start - lunch) / H;
  return h > 0 ? h : 8;
}

/** The day's lunch: none, the shift's usual one, or what Production confirmed. */
export function lunchWindow(shift, override) {
  if (override?.kind === 'none') return null;
  if (override?.kind === 'later' && toMin(override.from) !== null && toMin(override.to) !== null) {
    if (shift) {
      const from = shift.at(override.from);
      return [from, from + mod(toMin(override.to) - toMin(override.from)) * 60000];
    }
    return null;
  }
  return shift ? shift.lunch : null;
}

/**
 * Presence from the punches. No punch-out: on a finished day, until the shift
 * ends (or the end of that day when no shifts are set); today, until `now`.
 */
export function presence(row, shift, now = Date.now()) {
  if (!row?.punchIn) return null;
  const start = new Date(row.punchIn).getTime();
  if (row.punchOut) return [start, new Date(row.punchOut).getTime()];
  const sameDay = indiaDateOf(row.punchIn) === indiaDateOf(now);
  if (sameDay) return [start, now];
  if (shift) return [start, Math.max(start, shift.end)];
  return [start, indiaMidnight(row.punchIn).getTime() + DAY_MIN * 60000];
}

/**
 * One person's hours on a step.
 * stints: [{ joinedAt, leftAt }] (leftAt null = still on it)
 * window: [start, end] of the step (or of this rework round)
 * days: [{ date, punchIn, punchOut }] attendance rows
 * shifts: the policy's shifts; overrides: { 'YYYY-MM-DD': { kind, from, to } }
 * Returns { hours, days: [{ date, hours, lunchTaken, shift, intervals }] }
 */
export function personStepHours({ stints = [], window, days = [], shifts = [], overrides = {}, now = Date.now() }) {
  const win = [new Date(window[0]).getTime(), new Date(window[1] ?? now).getTime()];
  const out = [];
  for (const row of days) {
    const shift = shiftForDay(row.punchIn, shifts);
    const pres = presence(row, shift, now);
    if (!pres) continue;
    const lunch = lunchWindow(shift, overrides[row.date]);
    let worked = 0, lunchTaken = 0;
    const intervals = [];
    for (const st of stints) {
      const s = [new Date(st.joinedAt).getTime(), st.leftAt ? new Date(st.leftAt).getTime() : now];
      const iv = clip(clip(s, win) || [0, 0], pres);
      if (!iv) continue;
      const pieces = lunch ? minus(iv, lunch) : [iv];
      worked += pieces.reduce((t, p) => t + len(p), 0);
      lunchTaken += lunch ? len(clip(iv, lunch)) : 0;
      intervals.push(...pieces);
    }
    if (worked > 0 || lunchTaken > 0) {
      out.push({ date: row.date, hours: worked / H, lunchTaken: lunchTaken / H, shift: shift?.name || null, shiftHours: shiftHoursOf(shift), intervals });
    }
  }
  return { hours: out.reduce((t, d) => t + d.hours, 0), days: out };
}

/** A step's totals from each person's result: person-hours, hours anyone worked, crew size. */
export function stepTotals(people) {
  const personHours = people.reduce((t, p) => t + p.hours, 0);
  const workingHours = unionLength(people.flatMap((p) => p.days.flatMap((d) => d.intervals))) / H;
  const crewSize = workingHours > 0 ? Math.max(1, Math.round(personHours / workingHours)) : 0;
  return { personHours, workingHours, crewSize };
}

/**
 * Usual time for `people` people on `pieces` pieces, from finished runs of this
 * step of this part. The last 10 runs (rework kept out); runs with exactly this
 * many people first, otherwise the overall work per piece split evenly.
 * runs: [{ personHours, pieces, crewSize, rework, completedAt }]
 */
export function averageFor(runs = [], people = 1, pieces = 1) {
  const recent = runs.filter((r) => !r.rework && r.pieces > 0 && r.personHours > 0)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).slice(0, 10);
  if (!recent.length || !(people > 0)) return { hours: null, basis: 'none', runCount: 0 };
  const perPiece = (list) => list.reduce((t, r) => t + r.personHours / r.pieces, 0) / list.length;
  const same = recent.filter((r) => r.crewSize === people);
  if (same.length) return { hours: (perPiece(same) * pieces) / people, basis: 'runs', runCount: same.length };
  return { hours: (perPiece(recent) * pieces) / people, basis: 'estimated', runCount: recent.length };
}

/** Expected person-hours per piece over the last 10 runs, for efficiency. */
export function expectedPerPiece(runs = []) {
  const recent = runs.filter((r) => !r.rework && r.pieces > 0 && r.personHours > 0)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).slice(0, 10);
  return recent.length ? recent.reduce((t, r) => t + r.personHours / r.pieces, 0) / recent.length : null;
}

/**
 * The lunches that fall inside a step, one line per person per day, for the
 * Complete dialog: the usual lunch of that day's shift (or the one already
 * confirmed), where it overlaps this person's time on the step.
 */
export function lunchLines({ stints = [], window, days = [], shifts = [], overrides = {}, now = Date.now() }) {
  const win = [new Date(window[0]).getTime(), new Date(window[1] ?? now).getTime()];
  const lines = [];
  for (const row of days) {
    const shift = shiftForDay(row.punchIn, shifts);
    if (!shift?.lunch) continue;
    const pres = presence(row, shift, now);
    if (!pres) continue;
    const overlaps = stints.some((st) => {
      const s = [new Date(st.joinedAt).getTime(), st.leftAt ? new Date(st.leftAt).getTime() : now];
      const iv = clip(clip(s, win) || [0, 0], pres);
      return iv && clip(iv, shift.lunch);
    });
    if (!overlaps) continue;
    const fmt = (ms) => { const m = indiaMinuteOfDay(ms); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
    const o = overrides[row.date];
    lines.push({
      date: row.date, shift: shift.name,
      usual: { from: fmt(shift.lunch[0]), to: fmt(shift.lunch[1]) },
      answer: o ? { kind: o.kind, from: o.from || null, to: o.to || null } : { kind: 'usual' },
    });
  }
  return lines;
}
