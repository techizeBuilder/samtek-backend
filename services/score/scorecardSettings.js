// Feature 13 (2026-11-17): the scorecard's settings, versioned by month.
// docs/client-features-2026-11/13-employee-scorecard-logic.md §14.
// The Company Admin sets the points per parameter (whole numbers adding up to
// 100) and the conduct-note deductions. A save applies from a month the admin
// picks (this month or later), so earlier months keep the version they had.
import mongoose from 'mongoose';
import ScorecardSettings from '../../models/ScorecardSettings.js';
import User from '../../models/User.js';
import { PARAM_KEYS } from './scoreCalc.js';

export class SettingsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// The client's draft (17 Nov 2026).
export const CLIENT_DEFAULTS = Object.freeze({
  points: Object.freeze({
    attendance: 10, punctuality: 8, noDelay: 10,
    accuracy: 12, quality: 10, productivity: 12, taskCompletion: 10,
    behaviour: 8, discipline: 5, teamwork: 5,
    ownership: 5, safety: 3, learning: 2,
  }),
  deductions: Object.freeze({ minor: 25, major: 50, serious: 100 }),
  incentiveCap: null, // feature 15: no limit until the Company Admin sets one
});

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const IST_MS = 5.5 * 3600 * 1000;
export const thisMonthIndia = (now = Date.now()) => new Date(now + IST_MS).toISOString().slice(0, 7);
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const plain = (v) => ({
  points: Object.fromEntries(PARAM_KEYS.map((k) => [k, Number(v.points?.[k]) || 0])),
  deductions: { minor: Number(v.deductions?.minor) || 0, major: Number(v.deductions?.major) || 0, serious: Number(v.deductions?.serious) || 0 },
  incentiveCap: v.incentiveCap == null ? null : Number(v.incentiveCap),
});

/**
 * The settings in force for a month: the latest version applying from that month
 * or earlier (the latest saved when two apply from the same month); the client's
 * defaults when none was ever saved.
 */
export async function settingsFor(companyId, month) {
  const v = await ScorecardSettings.findOne({ company: oid(companyId), department: null, effectiveFrom: { $lte: month } })
    .sort({ effectiveFrom: -1, createdAt: -1, _id: -1 }).lean();
  if (!v) return { ...plain(CLIENT_DEFAULTS), version: null, effectiveFrom: null, defaults: true };
  return { ...plain(v), version: v._id, effectiveFrom: v.effectiveFrom, savedByName: v.savedByName, savedAt: v.createdAt, defaults: false };
}

const whole = (x) => Number.isInteger(x) && x >= 0;

/** A new version. Refused unless the points are whole numbers adding up to 100 and the month isn't past. */
export async function saveSettings(user, body = {}) {
  const effectiveFrom = String(body.effectiveFrom || '');
  if (!MONTH_RE.test(effectiveFrom)) throw new SettingsError(400, 'Choose the month it applies from, like 2026-12.');
  if (effectiveFrom < thisMonthIndia()) throw new SettingsError(400, `A change can't apply to a past month. Choose ${thisMonthIndia()} or later.`);
  const points = {};
  for (const k of PARAM_KEYS) {
    const x = Number(body.points?.[k]);
    if (!whole(x)) throw new SettingsError(400, 'Each part needs whole points, 0 or more.');
    points[k] = x;
  }
  const total = Object.values(points).reduce((s, x) => s + x, 0);
  if (total !== 100) throw new SettingsError(400, `The points add up to ${total}. They must add up to 100.`);
  const deductions = {};
  for (const k of ['minor', 'major', 'serious']) {
    const x = Number(body.deductions?.[k]);
    if (!whole(x) || x > 100) throw new SettingsError(400, 'Each deduction is a whole % from 0 to 100.');
    deductions[k] = x;
  }
  // Feature 15: the incentive cap — empty = no limit, else whole rupees, 0 or more.
  let incentiveCap = null;
  if (body.incentiveCap != null && String(body.incentiveCap).trim() !== '') {
    incentiveCap = Number(body.incentiveCap);
    if (!whole(incentiveCap)) throw new SettingsError(400, 'The incentive cap is whole rupees, 0 or more, or empty for no limit.');
  }
  const doc = await ScorecardSettings.create({
    company: user.companyId, department: null, effectiveFrom, points, deductions, incentiveCap,
    savedBy: user._id,
    savedByName: (await User.findById(user._id).select('fullName username').lean())?.fullName || user.username || '', // req.user has no full name
  });
  return doc.toObject();
}

/** The settings in force this month, and every saved version (newest first), paged. */
export async function settingsView(companyId, { page = 1, limit = 10 } = {}) {
  const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const q = { company: oid(companyId), department: null };
  const [current, versions, total] = await Promise.all([
    settingsFor(companyId, thisMonthIndia()),
    ScorecardSettings.find(q).sort({ createdAt: -1, _id: -1 }).skip((pg - 1) * lim).limit(lim).lean(),
    ScorecardSettings.countDocuments(q),
  ]);
  // A version saved for a later month: the admin sees it is waiting.
  const upcoming = await ScorecardSettings.findOne({ ...q, effectiveFrom: { $gt: thisMonthIndia() } }).sort({ effectiveFrom: 1, createdAt: -1 }).lean();
  return {
    month: thisMonthIndia(), current, upcoming: upcoming ? { ...plain(upcoming), effectiveFrom: upcoming.effectiveFrom, savedByName: upcoming.savedByName, savedAt: upcoming.createdAt } : null,
    defaults: CLIENT_DEFAULTS, versions, total, page: pg, limit: lim,
  };
}
