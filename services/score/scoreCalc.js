// The employee scorecard (feature 13, 2026-11-17; replaces feature 10's 40/60
// score). Pure: no database, so the hand-worked totals in
// docs/client-features-2026-11/13-employee-scorecard-logic.md test it directly.
//
// 13 parameters, points set by the Company Admin (client's defaults add up to 100).
// Each parameter = its points × the share achieved. Parameters that can't be
// measured for someone are left out and the rest scaled to 100:
//   score = earned ÷ the points of the measured parameters × 100
//
// Kept from feature 10: timing points, timing bands, a unit's / batch's QC
// accuracy, and which QC check judges a step.

export const TIMING_CAP = 110;
export const MIN_STEPS = 3; // the step parts need 3 measured steps in the month
export const MIN_DAYS = 5;  // the score needs 5 eligible days
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

export const GROUPS = [
  { key: 'A', label: 'Attendance & time' },
  { key: 'B', label: 'Work performance' },
  { key: 'C', label: 'Behaviour & discipline' },
  { key: 'D', label: 'Responsibility' },
  { key: 'E', label: 'Safety & development' },
];
export const PARAMS = [
  { key: 'attendance', group: 'A', label: 'Attendance' },
  { key: 'punctuality', group: 'A', label: 'Punctuality' },
  { key: 'noDelay', group: 'A', label: 'No work delay' },
  { key: 'accuracy', group: 'B', label: 'Accuracy' },
  { key: 'quality', group: 'B', label: 'Work quality' },
  { key: 'productivity', group: 'B', label: 'Productivity' },
  { key: 'taskCompletion', group: 'B', label: 'Task completion' },
  { key: 'behaviour', group: 'C', label: 'Behaviour', conduct: 'Behaviour' },
  { key: 'discipline', group: 'C', label: 'Discipline', conduct: 'Discipline' },
  { key: 'teamwork', group: 'C', label: 'Teamwork', conduct: 'Teamwork' },
  { key: 'ownership', group: 'D', label: 'Ownership', conduct: 'Ownership' },
  { key: 'safety', group: 'E', label: 'Safety & rules', conduct: 'Safety' },
  { key: 'learning', group: 'E', label: 'Learning & improvement' },
];
export const PARAM_KEYS = PARAMS.map((p) => p.key);
export const STEP_KEYS = ['noDelay', 'accuracy', 'quality', 'productivity', 'taskCompletion'];

// ── Kept from feature 10 ─────────────────────────────────────────────────────

/** Timing points for one step: planned ÷ took × 100, capped. null without both. */
export function timingPoints(planned, took) {
  if (!(planned > 0) || !(took > 0)) return null;
  return Math.min(TIMING_CAP, (planned / took) * 100);
}

/** Early (more than 10% under plan), On time (within 10%), Late (more than 10% over). */
export function timingBand(planned, took) {
  if (!(planned > 0) || !(took > 0)) return null;
  const ratio = took / planned;
  if (ratio < 0.9) return 'Early';
  if (ratio > 1.1) return 'Late';
  return 'On time';
}

export function unitAccuracy(decision) {
  if (decision === 'Pass') return 100;
  if (decision === 'Reject' || decision === 'Fail') return 0;
  return null;
}

export function batchAccuracy(passed, submitted) {
  if (!(submitted > 0) || passed == null) return null;
  return Math.max(0, Math.min(100, (passed / submitted) * 100));
}

/**
 * Which QC check judges a step: the next step at or after it with a QC check, so
 * every in-house step since the previous check is judged by it. A check on an
 * outsourced step judges the vendor, not our crew → null. No check after it → null.
 */
export function judgingCheck(procs = [], stepIndex) {
  for (let j = stepIndex; j < procs.length; j++) {
    const p = procs[j];
    if (p?.qcRequired || p?.finalQc) return p.type === 'Outsourcing' ? null : j;
  }
  return null;
}

// ── Grades ───────────────────────────────────────────────────────────────────

export const GRADES = [
  { grade: 'A+', min: 90, meaning: 'Outstanding' },
  { grade: 'A', min: 80, meaning: 'Excellent' },
  { grade: 'B', min: 70, meaning: 'Good' },
  { grade: 'C', min: 60, meaning: 'Average' },
  { grade: 'D', min: 50, meaning: 'Needs improvement' },
  { grade: 'E', min: -Infinity, meaning: 'Poor' },
];
export function grade(score) {
  if (score == null) return null;
  return GRADES.find((g) => score >= g.min).grade;
}
export const gradeMeaning = (g) => GRADES.find((x) => x.grade === g)?.meaning || '';

// ── The parts ────────────────────────────────────────────────────────────────

/**
 * Attendance from payroll's day kinds (services/payroll/payrollCalc.js dayKinds).
 * Eligible = the days someone was expected: present, half day, absent. Weekly
 * offs, holidays, approved leave (paid or unpaid), days before joining and days
 * not come yet are left out. A half day = ½ present of 1 day, or ½ of ½ when
 * approved leave covers the other half.
 * recorded = the person has at least one attendance record in the period. With
 * none (not on the device yet, never marked on screen) absence can't be told
 * from "not recorded", so attendance isn't measured (17 Nov); the eligible days
 * still count for the 5-day minimum.
 */
export function attendancePart(days = [], { recorded = true } = {}) {
  let present = 0, eligible = 0;
  for (const d of days) {
    if (d.kind === 'present') { present += 1; eligible += 1; }
    else if (d.kind === 'halfDay') { present += 0.5; eligible += d.pay === 1 ? 0.5 : 1; }
    else if (d.kind === 'absent') eligible += 1;
  }
  if (!recorded) return { share: null, present: 0, eligible, why: 'none' };
  return { share: eligible > 0 ? present / eligible : null, present, eligible };
}

/**
 * Punctuality: on-time days ÷ days present, from the device's own lateness.
 * rows = the attendance rows of the days counted present or half day; only
 * device rows know lateness, so the others are left out. On time = late no
 * more than the grace time. No device days → not measured.
 */
export function punctualityPart(rows = [], graceSeconds = 600) {
  const known = rows.filter((r) => r && r.source === 'Device');
  const onTime = known.filter((r) => (Number(r.lateSeconds) || 0) <= graceSeconds).length;
  return { share: known.length ? onTime / known.length : null, onTime, days: known.length };
}

const severityError = (s) => (s === 'Minor' ? 0.5 : 1); // Major, Critical or not graded = 1

/**
 * First-time-right error for one judged step, by its first QC result (0 = right).
 * A unit: Pass 0, Reject by the grade (Minor ½, else 1).
 * A batch (17 Nov, browser test): the share of pieces sent back, by the grade, so
 * 2 of 12 sent back (Major) = 1/6 of a mistake, not the whole batch.
 */
export function ftrError({ batch = false, decision = null, passed = null, submitted = null, severity = null } = {}) {
  if (batch) {
    if (!(submitted > 0) || passed == null) return null;
    const back = Math.max(0, Math.min(submitted, submitted - passed));
    return back === 0 ? 0 : (back / submitted) * severityError(severity);
  }
  if (decision === 'Pass') return 0;
  if (decision === 'Reject' || decision === 'Fail') return severityError(severity);
  return null;
}

/**
 * The five step parts, each step weighted by the person's hours on it.
 * items: finished steps [{ weight, timing, band, accuracy, error, rework }]
 *   timing/band: null for a redo round or a step with no planned hours
 *   accuracy: the QC pass rate (quality); error: first-time-right error (accuracy)
 * unfinished: steps still open at the month's end past their planned hours [{ weight }]
 * Under MIN_STEPS measured steps → none of them is measured.
 */
export function stepParts(items = [], unfinished = []) {
  const steps = items.filter((it) => Number(it.weight) > 0 && (it.timing != null || it.accuracy != null));
  const out = Object.fromEntries(STEP_KEYS.map((k) => [k, { share: null }]));
  out.measuredSteps = steps.length;
  if (steps.length < MIN_STEPS) {
    for (const k of STEP_KEYS) out[k] = { share: null, why: 'steps' };
    return out;
  }
  const wsum = (list, f) => list.reduce((s, it) => s + Number(it.weight) * f(it), 0);
  const banded = steps.filter((it) => it.band);
  if (banded.length) {
    const all = wsum(banded, () => 1), notLate = wsum(banded, (it) => (it.band === 'Late' ? 0 : 1));
    out.noDelay = { share: notLate / all, steps: banded.length, late: banded.filter((it) => it.band === 'Late').length };
  }
  const timed = steps.filter((it) => it.timing != null);
  if (timed.length) {
    const avg = wsum(timed, (it) => it.timing) / wsum(timed, () => 1);
    out.productivity = { share: Math.min(100, avg) / 100, average: r1(avg), steps: timed.length };
  } else out.productivity = { share: null, why: 'plan' };
  const judged = steps.filter((it) => it.accuracy != null);
  if (judged.length) {
    const w = wsum(judged, () => 1);
    out.quality = { share: wsum(judged, (it) => it.accuracy) / w / 100, average: r1(wsum(judged, (it) => it.accuracy) / w), steps: judged.length };
  } else out.quality = { share: null, why: 'qc' };
  const ftr = steps.filter((it) => it.error != null);
  if (ftr.length) {
    out.accuracy = {
      share: wsum(ftr, (it) => 1 - it.error) / wsum(ftr, () => 1), steps: ftr.length,
      firstTime: ftr.filter((it) => it.error === 0).length, sentBack: ftr.filter((it) => it.error > 0).length,
      minor: ftr.filter((it) => it.error > 0 && it.severity === 'Minor').length, major: ftr.filter((it) => it.error > 0 && it.severity !== 'Minor').length,
    };
  } else out.accuracy = { share: null, why: 'qc' };
  const done = steps.filter((it) => !it.rework);
  const open = unfinished.filter((u) => Number(u.weight) > 0);
  const doneW = wsum(done, () => 1), openW = wsum(open, () => 1);
  out.taskCompletion = doneW + openW > 0
    ? { share: doneW / (doneW + openW), finished: done.length, unfinished: open.length }
    : { share: null, why: 'steps' };
  return out;
}

/**
 * A conduct parameter: full points, less each verified Concern of that type
 * (deductions = % of the points for Minor / Major / Serious), never below 0.
 */
export function conductPart(points, notes = [], deductions = { minor: 25, major: 50, serious: 100 }) {
  let off = 0;
  const counted = notes.filter((n) => n.status === 'Verified' && n.kind !== 'Appreciation');
  for (const n of counted) off += points * (Number(deductions[String(n.severity || '').toLowerCase()]) || 0) / 100;
  const earned = Math.max(0, points - off);
  return { share: points > 0 ? earned / points : null, notes: counted.length, off: r3(Math.min(points, off)) };
}

/** Learning: half the points by default, full with evidence in the last 3 months. */
export function learningPart(evidence = []) {
  return { share: evidence.length ? 1 : 0.5, evidence };
}

// The parts that start from a fixed amount rather than being measured: the five
// conduct parts (start full) and learning (half by default). They keep their own
// points and are never scaled up (17 Nov, browser test).
const FIXED = new Set([...PARAMS.filter((p) => p.conduct).map((p) => p.key), 'learning']);

/**
 * The scorecard from its parts. parts = { key: { share | null, ...detail } };
 * settings = { points, deductions }; eligibleDays from attendancePart.
 * score = (measured parts' earned ÷ their points) × all measurable parts' points
 *         + the fixed parts' points, out of the total.
 * So a part that can't be measured is filled in by the measured ones, but the
 * conduct and learning points are never stretched to cover it. Nothing measured
 * (only the fixed parts) → no score. With everything measured it's simply the sum.
 * Returns { score, grade, earned, possible, groups[], parts[] }; score null
 * under MIN_DAYS eligible days (reason 'days') or when nothing is measured.
 */
export function scorecard(parts = {}, settings, { eligibleDays = 0 } = {}) {
  let earned = 0, possible = 0;
  let perfEarned = 0, perfPossible = 0, perfTotal = 0, fixedEarned = 0, fixedTotal = 0;
  const rows = PARAMS.map((p) => {
    const max = Number(settings.points?.[p.key]) || 0;
    const part = parts[p.key] || { share: null };
    const measured = max > 0 && part.share != null;
    const got = measured ? max * part.share : null;
    if (measured) { earned += got; possible += max; }
    if (FIXED.has(p.key)) {
      if (measured) { fixedEarned += got; fixedTotal += max; }
    } else if (max > 0) {
      perfTotal += max;
      if (measured) { perfEarned += got; perfPossible += max; }
    }
    const { share, ...detail } = part;
    return { key: p.key, label: p.label, group: p.group, max, measured, points: r3(got), share: share == null ? null : r3(share), ...detail };
  });
  const groups = GROUPS.map((g) => {
    const mine = rows.filter((r) => r.group === g.key);
    const m = mine.filter((r) => r.measured);
    return {
      key: g.key, label: g.label, max: mine.reduce((s, r) => s + r.max, 0),
      points: m.length ? r3(m.reduce((s, r) => s + r.points, 0)) : null, possible: m.reduce((s, r) => s + r.max, 0),
    };
  });
  const enoughDays = eligibleDays >= MIN_DAYS;
  const measuredSomething = perfPossible > 0;
  const raw = enoughDays && measuredSomething
    ? (((perfEarned / perfPossible) * perfTotal + fixedEarned) / (perfTotal + fixedTotal)) * 100
    : null;
  return {
    score: r1(raw), grade: grade(raw == null ? null : r1(raw)), earned: r3(earned), possible,
    reason: !enoughDays ? 'days' : measuredSomething ? null : 'nothing', groups, parts: rows,
  };
}

/** A team: its members' scores, weighted by their hours with the team. */
export function teamScore(members = []) {
  const m = members.filter((x) => x.score != null && Number(x.weight) > 0);
  if (!m.length) return { score: null, grade: null, people: 0 };
  const w = m.reduce((s, x) => s + Number(x.weight), 0);
  const s = r1(m.reduce((t, x) => t + x.score * Number(x.weight), 0) / w);
  return { score: s, grade: grade(s), people: m.length };
}
