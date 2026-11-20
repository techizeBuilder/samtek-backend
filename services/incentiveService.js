// Feature 10 (2026-11-13): incentive requests — a department head asks, HR
// decides; HR can also give one directly. An approved incentive is added to that
// month's payroll (payrollService loads approved ones). docs/client-features-2026-11/10-performance-score-logic.md §8
import mongoose from 'mongoose';
import IncentiveRequest from '../models/IncentiveRequest.js';
import User from '../models/User.js';
import Payroll from '../models/Payroll.js';
import notificationService from './notificationService.js';
import { personScore } from './score/scoreService.js';
import { companyDepartments, departmentOf } from './departmentSeedService.js';
import { settingsFor } from './score/scorecardSettings.js';

export class IncentiveError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const nameOf = (u) => u?.fullName || u?.username || '';
// req.user carries no full name: look it up, so rows say "Rahul Pramanik", not "testhr" (18 Nov 2026).
const whoIs = async (user) => (user?.fullName ? user.fullName : nameOf(await User.findById(user?._id).select('fullName username').lean()) || user?.username || '');
const HR_ROLES = ['HR-Admin'];
// For notifications: "₹2,000" and "November 2026", not "₹2000" and "2026-11".
const rupees = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
const monthText = (m) => (MONTH_RE.test(m || '') ? new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : m);

async function personIn(companyId, personId) {
  if (!mongoose.isValidObjectId(personId)) throw new IncentiveError(404, 'Person not found');
  const p = await User.findOne({ _id: personId, companyId }).select('fullName username departmentId role isActive').lean();
  if (!p) throw new IncentiveError(404, 'Person not found');
  // The department saved on the request: set on them, else their role's (18 Nov 2026).
  return { ...p, departmentId: departmentOf(p, await companyDepartments(companyId))?._id || null };
}

function checkMonth(month) {
  if (!MONTH_RE.test(String(month || ''))) throw new IncentiveError(400, 'Choose the month it is paid with, like 2026-11.');
}

// Paid with a payroll that's already saved for this person → too late for that month.
async function checkPayrollOpen(personId, month) {
  if (await Payroll.exists({ employee: personId, month })) {
    throw new IncentiveError(400, `Payroll for ${month} is already run for this person. Choose the next month.`);
  }
}

async function snapshot(companyId, personId) {
  // Feature 13 (2026-11-17): the scorecard as it stood — score, grade, out of how many points, each part.
  const s = await personScore(companyId, personId, { stepsLimit: 1 });
  return s ? {
    score: s.score, grade: s.grade, month: s.month, earned: s.earned, possible: s.possible, measured: s.measuredSteps, from: s.from, to: s.to,
    parts: (s.parts || []).map((p) => ({ key: p.key, points: p.points, max: p.max, measured: p.measured })),
  } : undefined;
}

const notify = async (fn) => { try { await fn(); } catch (e) { console.error('[Incentive] notify failed:', e.message); } };

// ── Feature 15 (2026-11-18): the cap. docs/client-features-2026-11/15-incentive-cap-logic.md
// HR approves alone up to the cap per person per payroll month (everything already
// approved for that month + this one, decision A); above it the Company Admin decides.
// No cap set = no limit (C). The Company Admin's own decisions are never capped.
const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
const isAdmin = (user) => ADMIN_ROLES.includes(user?.role);

async function capInfo(companyId, personId, month, exceptId = null) {
  const { incentiveCap } = await settingsFor(companyId, month);
  const q = { company: companyId, person: personId, month, status: 'Approved' };
  if (exceptId) q._id = { $ne: exceptId };
  const rows = await IncentiveRequest.find(q).select('amount').lean();
  return { cap: incentiveCap ?? null, approvedBefore: Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100 };
}
const overCap = (user, info, amt) => !isAdmin(user) && info.cap != null && info.approvedBefore + amt > info.cap;

const tellAdmins = (doc) => notify(() => notificationService.notifyRoles(['Company Admin'], {
  title: `Incentive above the cap — ${doc.personName}`,
  message: `${doc.forwardedByName || 'HR'} ${doc.direct ? 'wants to give' : 'approved'} ${rupees(doc.amount)} for ${doc.personName} (${monthText(doc.month)}). With ${rupees(doc.capCheck?.approvedBefore)} already approved that month it's above the cap of ${rupees(doc.capCheck?.cap)}, so it waits for you.`,
  type: 'hrms', icon: 'award', priority: 'high', targetCompanyId: doc.company,
  data: { incentiveId: doc._id, person: doc.person, link: '/hrms/CompanyAdmin/employee-performance?tab=requests' },
}));
const tellForwarder = (doc, title, message) => doc.forwardedBy && notify(() => notificationService.createNotification({
  title, message, type: 'hrms', icon: 'award', priority: 'medium', targetUserId: doc.forwardedBy, targetCompanyId: doc.company,
  data: { incentiveId: doc._id, person: doc.person, link: '/hrms/SuperAdmin/manpower-score?tab=requests' },
}));

/** What the Give / Approve box shows: the cap for that month and what's already approved. */
export async function incentiveCapView(user, personId, month, exceptId = null) {
  const p = await personIn(user.companyId, personId);
  checkMonth(month);
  const info = await capInfo(user.companyId, p._id, month, mongoose.isValidObjectId(exceptId) ? exceptId : null);
  return { ...info, month, admin: isAdmin(user) };
}

/** A department head asks for an incentive for one of their people. */
export async function requestIncentive(user, { person, month, reason, suggestedAmount }) {
  const p = await personIn(user.companyId, person);
  checkMonth(month);
  if (!String(reason || '').trim()) throw new IncentiveError(400, 'Say why they deserve it.');
  const amt = suggestedAmount == null || suggestedAmount === '' ? null : Number(suggestedAmount);
  if (amt != null && !(amt > 0)) throw new IncentiveError(400, 'A suggested amount must be above 0, or left empty.');
  await checkPayrollOpen(p._id, month);
  const doc = await IncentiveRequest.create({
    company: user.companyId, person: p._id, personName: nameOf(p), department: p.departmentId || null, month,
    reason: String(reason).trim(), suggestedAmount: amt, status: 'Requested', scoreSnapshot: await snapshot(user.companyId, p._id),
    requestedBy: user._id, requestedByName: await whoIs(user),
  });
  await notify(() => notificationService.notifyRoles(HR_ROLES, {
    title: `Incentive requested — ${nameOf(p)}`,
    message: `${doc.requestedByName || 'A department head'} asks for an incentive for ${nameOf(p)} (${monthText(month)})${amt ? `, suggested ${rupees(amt)}` : ''}: ${doc.reason}`,
    type: 'hrms', icon: 'award', priority: 'medium', targetCompanyId: user.companyId,
    data: { incentiveId: doc._id, person: p._id, link: '/hrms/SuperAdmin/manpower-score?tab=requests' },
  }));
  return doc;
}

async function loadRequest(user, id) {
  const doc = mongoose.isValidObjectId(id) && await IncentiveRequest.findOne({ _id: id, company: user.companyId });
  if (!doc) throw new IncentiveError(404, 'Request not found');
  // Above the cap it's the Company Admin's to decide (feature 15).
  if (doc.status === 'AwaitingAdmin') {
    if (!isAdmin(user)) throw new IncentiveError(403, 'This one is above the cap: it waits for the Company Admin.');
    return doc;
  }
  if (doc.status !== 'Requested') throw new IncentiveError(400, `This request is already ${doc.status.toLowerCase()}.`);
  return doc;
}

const tellRequester = (doc, title, message) => doc.requestedBy && notify(() => notificationService.createNotification({
  title, message, type: 'production', icon: 'award', priority: 'medium', targetUserId: doc.requestedBy, targetCompanyId: doc.company,
  data: { incentiveId: doc._id, person: doc.person, link: '/production/manpower?view=scores' },
}));

/**
 * HR approves, with the amount and the month it's paid with. Above the cap it goes
 * to the Company Admin instead (feature 15), who approves it here too, uncapped.
 */
export async function approveIncentive(user, id, { amount, month }) {
  const doc = await loadRequest(user, id);
  const wasWaiting = doc.status === 'AwaitingAdmin';
  const amt = Number(amount ?? (wasWaiting ? doc.amount : NaN));
  if (!(amt > 0)) throw new IncentiveError(400, 'Enter the amount, above 0.');
  const m = month || doc.month;
  checkMonth(m);
  await checkPayrollOpen(doc.person, m);
  const rounded = Math.round(amt * 100) / 100;
  if (!wasWaiting) {
    const info = await capInfo(user.companyId, doc.person, m, doc._id);
    if (overCap(user, info, rounded)) {
      Object.assign(doc, { status: 'AwaitingAdmin', amount: rounded, month: m, forwardedBy: user._id, forwardedByName: await whoIs(user), forwardedAt: new Date(), capCheck: info });
      await doc.save();
      await tellAdmins(doc);
      await tellRequester(doc, `Incentive sent to the Company Admin — ${doc.personName}`, `${doc.forwardedByName || 'HR'} approved ${rupees(doc.amount)} for ${doc.personName}. It's above the monthly cap, so the Company Admin decides.`);
      return doc;
    }
  }
  Object.assign(doc, { status: 'Approved', amount: rounded, month: m, decidedBy: user._id, decidedByName: await whoIs(user), decidedAt: new Date() });
  await doc.save();
  const msg = `${doc.decidedByName || 'HR'} approved ${rupees(doc.amount)} for ${doc.personName}, paid with the ${monthText(m)} payroll.`;
  // A direct give's "requester" is the HR person who sent it up: one bell, not two (18 Nov browser test).
  if (!doc.direct) await tellRequester(doc, `Incentive approved — ${doc.personName}`, msg);
  if (wasWaiting) await tellForwarder(doc, `Incentive approved — ${doc.personName}`, msg);
  return doc;
}

/** HR rejects, saying why. */
export async function rejectIncentive(user, id, reason) {
  const doc = await loadRequest(user, id);
  if (!String(reason || '').trim()) throw new IncentiveError(400, 'Say why it is rejected.');
  const wasWaiting = doc.status === 'AwaitingAdmin';
  Object.assign(doc, { status: 'Rejected', rejectReason: String(reason).trim(), decidedBy: user._id, decidedByName: await whoIs(user), decidedAt: new Date() });
  await doc.save();
  const msg = `${doc.decidedByName || 'HR'} did not approve the incentive for ${doc.personName}: ${doc.rejectReason}`;
  if (!doc.direct) await tellRequester(doc, `Incentive not approved — ${doc.personName}`, msg);
  if (wasWaiting) await tellForwarder(doc, `Incentive not approved — ${doc.personName}`, msg);
  return doc;
}

/** HR gives an incentive directly, without a request. Above the cap it waits for the Company Admin (feature 15). */
export async function giveIncentive(user, { person, month, amount, reason }) {
  const p = await personIn(user.companyId, person);
  checkMonth(month);
  const amt = Number(amount);
  if (!(amt > 0)) throw new IncentiveError(400, 'Enter the amount, above 0.');
  await checkPayrollOpen(p._id, month);
  const rounded = Math.round(amt * 100) / 100;
  const name = await whoIs(user);
  const info = await capInfo(user.companyId, p._id, month);
  const base = {
    company: user.companyId, person: p._id, personName: nameOf(p), department: p.departmentId || null, month,
    reason: String(reason || '').trim(), amount: rounded, direct: true,
    scoreSnapshot: await snapshot(user.companyId, p._id), requestedBy: user._id, requestedByName: name,
  };
  if (overCap(user, info, rounded)) {
    const doc = await IncentiveRequest.create({ ...base, status: 'AwaitingAdmin', forwardedBy: user._id, forwardedByName: name, forwardedAt: new Date(), capCheck: info });
    await tellAdmins(doc);
    return doc;
  }
  return IncentiveRequest.create({ ...base, status: 'Approved', decidedBy: user._id, decidedByName: name, decidedAt: new Date() });
}

/** HR's list (or one person's history), newest first, paged and searched by name. */
export async function listIncentives(user, { status = '', month = '', person = '', persons = null, search = '', page = 1, limit = 20 } = {}) {
  const q = { company: user.companyId };
  if (['Requested', 'AwaitingAdmin', 'Approved', 'Rejected'].includes(status)) q.status = status;
  if (MONTH_RE.test(month)) q.month = month;
  if (person && mongoose.isValidObjectId(person)) q.person = person;
  else if (Array.isArray(persons)) q.person = { $in: persons };
  const s = String(search || '').trim();
  if (s) q.personName = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const [items, total] = await Promise.all([
    IncentiveRequest.find(q).sort({ createdAt: -1 }).skip((pg - 1) * lim).limit(lim).populate('department', 'name').lean(),
    IncentiveRequest.countDocuments(q),
  ]);
  return { items, total, page: pg, limit: lim };
}

/** One person's incentives for the score drawer, 10 a page (?incPage=). */
export async function personIncentives(user, personId, incPage) {
  const r = await listIncentives(user, { person: personId, page: incPage, limit: 10 });
  return { incentives: r.items, incentivesTotal: r.total, incentivesPage: r.page, incentivesLimit: r.limit };
}

/** Approved incentives for a month, summed per person (payroll reads this). */
export async function approvedForMonth(personIds, month) {
  const rows = await IncentiveRequest.find({ person: { $in: personIds }, month, status: 'Approved' }).select('person amount').lean();
  const m = new Map();
  for (const r of rows) m.set(String(r.person), (m.get(String(r.person)) || 0) + (Number(r.amount) || 0));
  return m;
}
