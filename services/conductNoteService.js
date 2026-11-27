// Feature 13 (2026-11-17): conduct notes — the scorecard's Behaviour, Discipline,
// Teamwork, Ownership and Safety. docs/client-features-2026-11/13-employee-scorecard-logic.md §5.
// A department head records a note with a written reason (today: Production via
// Manpower; HR for anyone). It counts only once HR verifies it; the writer can't
// verify their own. A verified note can be cancelled with a reason; nothing is deleted.
// Feature 24 (2026-11-23): a Warning always comes first — a concern can't be recorded on a type
// until the person has had HR's number of warnings for it in the last 3 months (counted ones).
// Immediate action (a concern with no warning first) only from HR, approved by the Company
// Admin. A Safety concern or warning needs a photo. docs/client-features-2026-11/24-conduct-warnings-logic.md
import mongoose from 'mongoose';
import ConductNote, { CONDUCT_TYPES, CONDUCT_SEVERITIES, CONDUCT_KINDS } from '../models/ConductNote.js';
import ConductWarningRules from '../models/ConductWarningRules.js';
import User from '../models/User.js';
import notificationService from './notificationService.js';
import { companyDepartments, departmentOf } from './departmentSeedService.js';

export class ConductError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const HR_ROLES = ['HR-Admin'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const IST_MS = 5.5 * 3600 * 1000;
const todayIndia = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const nameOf = (u) => u?.fullName || u?.username || '';
// req.user carries no full name: look it up, so notes say "Rahul Sharma", not a login id.
const whoIs = async (user) => (user?.fullName ? user.fullName : nameOf(await User.findById(user?._id).select('fullName username').lean()) || user?.username || '');
const notify = async (fn) => { try { await fn(); } catch (e) { console.error('[ConductNote] notify failed:', e.message); } };
const ADMIN_ROLES = ['Company Admin', 'Super Admin'];

// ── Feature 24: HR's warning rules ──
const DEFAULT_RULE = Object.freeze({ allowed: 1, countsAt: 'approval' });
const WARNING_MONTHS = 3;

/** The rules for every type (a type not saved uses 1 warning, after HR approves). */
export async function getRules(companyId) {
  const doc = await ConductWarningRules.findOne({ company: companyId }).lean();
  const rules = Object.fromEntries(CONDUCT_TYPES.map((t) => {
    const r = doc?.rules?.[t];
    return [t, { allowed: r?.allowed >= 1 && r?.allowed <= 5 ? r.allowed : DEFAULT_RULE.allowed, countsAt: r?.countsAt === 'once' ? 'once' : DEFAULT_RULE.countsAt }];
  }));
  return { rules, months: WARNING_MONTHS, savedByName: doc?.savedByName || '', updatedAt: doc?.updatedAt || null };
}

/** HR (or the Company Admin) saves the rules: each type 1–5 warnings, counted at once or after HR approves. */
export async function saveRules(user, body = {}) {
  const rules = {};
  for (const t of CONDUCT_TYPES) {
    const r = body.rules?.[t] || {};
    const allowed = Number(r.allowed);
    if (!Number.isInteger(allowed) || allowed < 1 || allowed > 5) throw new ConductError(400, `${t}: warnings allowed must be 1 to 5 (a warning always comes first).`);
    if (!['approval', 'once'].includes(r.countsAt)) throw new ConductError(400, `${t}: say whether a warning counts at once or after HR approves.`);
    rules[t] = { allowed, countsAt: r.countsAt };
  }
  await ConductWarningRules.findOneAndUpdate(
    { company: user.companyId },
    { $set: { rules, savedBy: user._id, savedByName: await whoIs(user) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return getRules(user.companyId);
}

/** The India date WARNING_MONTHS calendar months ago ('YYYY-MM-DD'): warnings dated on or after it count. */
export function warningsSince(now = new Date()) {
  const ist = new Date(now.getTime() + IST_MS);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth() - WARNING_MONTHS, d = ist.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/** A person's warnings per type in the last 3 months: { since, months, types: { T: { allowed, countsAt, counted, pending } } }. */
export async function warningState(companyId, personId) {
  const since = warningsSince();
  const [{ rules }, rows] = await Promise.all([
    getRules(companyId),
    ConductNote.find({ company: companyId, person: personId, kind: 'Warning', date: { $gte: since }, status: { $in: ['Pending', 'Verified'] } }).select('type status').lean(),
  ]);
  const types = Object.fromEntries(CONDUCT_TYPES.map((t) => [t, {
    ...rules[t],
    counted: rows.filter((r) => r.type === t && r.status === 'Verified').length,
    pending: rows.filter((r) => r.type === t && r.status === 'Pending').length,
  }]));
  return { since, months: WARNING_MONTHS, types };
}

/** HR and the writer: someone's warnings for a type are used up — the next note on it is a concern. */
const tellLimit = (doc, allowed) => notify(async () => {
  const title = `${doc.personName}: ${doc.type} warnings used (${allowed} of ${allowed})`;
  const message = `The next ${doc.type.toLowerCase()} note on ${doc.personName} is a concern (warnings count for ${WARNING_MONTHS} months).`;
  await notificationService.notifyRoles(HR_ROLES, { title, message, type: 'hrms', icon: 'clipboard', priority: 'medium', targetCompanyId: doc.company, data: { conductNoteId: doc._id, person: doc.person, link: '/hrms/SuperAdmin/manpower-score?tab=notes' } });
  await notificationService.createNotification({ title, message, type: 'hrms', icon: 'clipboard', priority: 'low', targetUserId: doc.recordedBy, targetCompanyId: doc.company, data: { conductNoteId: doc._id, person: doc.person, link: '/production/manpower?view=scores' } });
});

/**
 * Records a note. personQuery (optional) limits who may be written about — Production
 * passes its own people. canImmediate: the HR route (immediate action allowed).
 * A concern or a warning that waits goes to HR; an immediate one to the Company Admin.
 */
export async function recordNote(user, body = {}, { personQuery = null, attachment = null, canImmediate = false } = {}) {
  const personId = body.person;
  if (!mongoose.isValidObjectId(personId)) throw new ConductError(404, 'Person not found');
  const person = await User.findOne({ _id: personId, companyId: user.companyId }).select('fullName username departmentId role').lean();
  if (!person) throw new ConductError(404, 'Person not found');
  if (personQuery && !(await User.exists({ ...personQuery, _id: personId }))) {
    throw new ConductError(400, 'Only people in Production can be noted from here.');
  }
  if (String(personId) === String(user._id)) throw new ConductError(400, "You can't write a note about yourself.");
  const kind = CONDUCT_KINDS.includes(body.kind) ? body.kind : 'Concern';
  if (!CONDUCT_TYPES.includes(body.type)) throw new ConductError(400, `Pick what it's about: ${CONDUCT_TYPES.join(', ')}.`);
  const severity = kind === 'Concern' ? body.severity : null;
  if (kind === 'Concern' && !CONDUCT_SEVERITIES.includes(severity)) throw new ConductError(400, 'Pick how serious it is: Minor, Major or Serious.');
  const date = String(body.date || '');
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw new ConductError(400, 'Enter the date it happened.');
  if (date > todayIndia()) throw new ConductError(400, "The date can't be in the future.");
  const reason = String(body.reason || '').trim();
  if (reason.length < 5) throw new ConductError(400, 'Write what happened. A note needs a written reason.');
  // Feature 24 (A): a Safety concern or warning needs a photo of what happened.
  if (body.type === 'Safety' && kind !== 'Appreciation') {
    if (!attachment) throw new ConductError(400, 'A Safety note needs a photo of what happened.');
    if (!/^image\//.test(attachment.mime || '')) throw new ConductError(400, "A Safety note needs a photo (JPG, PNG or WEBP): a PDF alone isn't enough.");
  }

  // Feature 24: a warning always comes first.
  const who = nameOf(person);
  let warning = null, immediate = false, immediateReason = '';
  if (kind !== 'Appreciation') {
    const s = (await warningState(user.companyId, person._id)).types[body.type];
    if (kind === 'Warning') {
      if (s.counted + s.pending >= s.allowed) {
        throw new ConductError(400, s.counted < s.allowed
          ? `${who} already has a ${body.type.toLowerCase()} warning waiting for HR (${s.counted + s.pending} of ${s.allowed}). Once HR approves it, the next note can be a concern.`
          : `${who} has had ${s.counted} of ${s.allowed} ${body.type.toLowerCase()} warnings (last ${WARNING_MONTHS} months). This one has to be a concern.`);
      }
      warning = { warningNumber: s.counted + s.pending + 1, warningsAllowed: s.allowed, once: s.countsAt === 'once' };
    } else if (s.counted < s.allowed) {
      // A concern before the warnings are used up: only immediate action, only from HR.
      if (!body.immediate) {
        throw new ConductError(400, `Give a warning first: ${who} has ${s.counted} of ${s.allowed} ${body.type.toLowerCase()} warning${s.allowed === 1 ? '' : 's'} (last ${WARNING_MONTHS} months)${s.pending ? `, and ${s.pending} waiting for HR` : ''}.`);
      }
      if (!canImmediate) throw new ConductError(403, 'Only HR can record immediate action (a concern without a warning first).');
      immediateReason = String(body.immediateReason || '').trim();
      if (immediateReason.length < 5) throw new ConductError(400, "Say why it can't wait for a warning.");
      immediate = true;
    }
  }

  const recordedByName = await whoIs(user);
  const doc = await ConductNote.create({
    company: user.companyId, person: person._id, personName: who,
    department: departmentOf(person, await companyDepartments(user.companyId))?._id || null, // set on them, else their role's
    kind, type: body.type, severity, date, reason, attachment: attachment ? { file: attachment.file, name: attachment.name } : null,
    recordedBy: user._id, recordedByName,
    ...(warning ? { warningNumber: warning.warningNumber, warningsAllowed: warning.warningsAllowed } : {}),
    // A warning HR's rule counts at once: no one verifies it.
    ...(warning?.once ? { status: 'Verified', autoCounted: true, decidedByName: 'Counted at once (warning rule)', decidedAt: new Date() } : {}),
    ...(immediate ? { immediate: true, immediateReason } : {}),
  });

  if (warning?.once) {
    if (warning.warningNumber === warning.warningsAllowed) await tellLimit(doc, warning.warningsAllowed);
    return doc;
  }
  if (immediate) {
    await notify(() => notificationService.notifyRoles(['Company Admin'], {
      title: `Immediate action to approve — ${doc.personName}`,
      message: `${recordedByName || 'HR'} recorded a ${severity} ${doc.type.toLowerCase()} concern with no warning first, on ${date}. Why it can't wait: ${immediateReason}. What happened: ${reason}`,
      type: 'hrms', icon: 'clipboard', priority: 'high', targetCompanyId: user.companyId,
      data: { conductNoteId: doc._id, person: person._id, link: '/hrms/CompanyAdmin/employee-performance?tab=notes' },
    }));
    return doc;
  }
  // A note HR writes also goes to the Company Admin, who can verify it when there's one HR person (18 Nov 2026).
  const verifiers = HR_ROLES.includes(user.role) ? [...HR_ROLES, 'Company Admin'] : HR_ROLES;
  const what = kind === 'Concern' ? `a ${severity} ${doc.type.toLowerCase()} concern`
    : kind === 'Warning' ? `${doc.type.toLowerCase()} warning ${warning.warningNumber} of ${warning.warningsAllowed}`
      : `an appreciation (${doc.type.toLowerCase()})`;
  await notify(() => notificationService.notifyRoles(verifiers, {
    title: `Conduct note to verify — ${doc.personName}`,
    message: `${doc.recordedByName || 'Someone'} noted ${what} on ${date}: ${reason}`,
    type: 'hrms', icon: 'clipboard', priority: 'medium', targetCompanyId: user.companyId,
    data: { conductNoteId: doc._id, person: person._id, link: '/hrms/SuperAdmin/manpower-score?tab=notes' },
  }));
  return doc;
}

async function loadNote(user, id, status) {
  const doc = mongoose.isValidObjectId(id) && await ConductNote.findOne({ _id: id, company: user.companyId });
  if (!doc) throw new ConductError(404, 'Note not found');
  if (status && doc.status !== status) throw new ConductError(400, `This note is ${doc.status.toLowerCase()}.`);
  return doc;
}

const tellWriter = (doc, title, message) => notify(() => notificationService.createNotification({
  title, message, type: 'hrms', icon: 'clipboard', priority: 'low', targetUserId: doc.recordedBy, targetCompanyId: doc.company,
  data: { conductNoteId: doc._id, person: doc.person, link: '/production/manpower?view=scores' },
}));

/** HR verifies: from now the note counts in its month. Not by the person who wrote it. */
// Feature 24: immediate action is decided by the Company Admin, not HR.
const checkDecider = (user, doc) => {
  if (doc.immediate && !ADMIN_ROLES.includes(user.role)) throw new ConductError(403, 'Immediate action (no warning first) is approved by the Company Admin.');
};

export async function verifyNote(user, id) {
  const doc = await loadNote(user, id, 'Pending');
  if (String(doc.recordedBy) === String(user._id)) throw new ConductError(403, 'Someone else must verify a note you wrote.');
  checkDecider(user, doc);
  Object.assign(doc, { status: 'Verified', decidedBy: user._id, decidedByName: await whoIs(user), decidedAt: new Date() });
  await doc.save();
  await tellWriter(doc, `Conduct note verified — ${doc.personName}`, `${doc.decidedByName || 'HR'} verified your note of ${doc.date} on ${doc.personName}.`); // the Company Admin may verify too
  // Feature 24: a warning approved — were that type's warnings just used up?
  if (doc.kind === 'Warning') {
    const s = (await warningState(doc.company, doc.person)).types[doc.type];
    if (s.counted === s.allowed) await tellLimit(doc, s.allowed);
  }
  return doc;
}

/** HR rejects, saying why. It never counts. */
export async function rejectNote(user, id, reason) {
  const doc = await loadNote(user, id, 'Pending');
  checkDecider(user, doc);
  if (!String(reason || '').trim()) throw new ConductError(400, 'Say why it is rejected.');
  Object.assign(doc, { status: 'Rejected', decisionReason: String(reason).trim(), decidedBy: user._id, decidedByName: await whoIs(user), decidedAt: new Date() });
  await doc.save();
  await tellWriter(doc, `Conduct note not accepted — ${doc.personName}`, `${doc.decidedByName || 'HR'} did not accept your note of ${doc.date} on ${doc.personName}: ${doc.decisionReason}`);
  return doc;
}

/** HR cancels a verified note, saying why. It stops counting; the history keeps it. */
export async function cancelNote(user, id, reason) {
  const doc = await loadNote(user, id, 'Verified');
  if (!String(reason || '').trim()) throw new ConductError(400, 'Say why it is cancelled.');
  Object.assign(doc, { status: 'Cancelled', cancelReason: String(reason).trim(), cancelledBy: user._id, cancelledByName: await whoIs(user), cancelledAt: new Date() });
  await doc.save();
  return doc;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Notes, newest first, paged; by status, person, month, or name search. persons limits to a set (Production's people). */
export async function listNotes(user, { status = '', person = '', month = '', search = '', page = 1, limit = 20 } = {}, { persons = null } = {}) {
  const q = { company: user.companyId };
  if (['Pending', 'Verified', 'Rejected', 'Cancelled'].includes(status)) q.status = status;
  // Feature 24: "Pending" is HR's queue; immediate action waits for the Company Admin.
  if (status === 'Pending') q.immediate = { $ne: true };
  if (status === 'AwaitingAdmin') Object.assign(q, { status: 'Pending', immediate: true });
  if (person && mongoose.isValidObjectId(person)) q.person = person;
  if (persons) q.person = q.person ? (persons.some((p) => String(p) === String(q.person)) ? q.person : null) : { $in: persons };
  if (MONTH_RE.test(month)) q.date = { $gte: `${month}-01`, $lte: `${month}-31` };
  const s = String(search || '').trim();
  if (s) q.personName = new RegExp(esc(s), 'i');
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const scope = { company: user.companyId, status: 'Pending', ...(persons ? { person: { $in: persons } } : {}) };
  const [items, total, waiting, awaitingAdmin] = await Promise.all([
    ConductNote.find(q).sort({ createdAt: -1 }).skip((pg - 1) * lim).limit(lim).populate('department', 'name').lean(),
    ConductNote.countDocuments(q),
    ConductNote.countDocuments({ ...scope, immediate: { $ne: true } }),
    ConductNote.countDocuments({ ...scope, immediate: true }),
  ]);
  return { items: items.map((n) => ({ ...n, attachment: n.attachment ? { name: n.attachment.name } : null })), total, page: pg, limit: lim, waiting, awaitingAdmin };
}

/** A note's file, for someone allowed to see the note (persons limits like listNotes). */
export async function noteFile(user, id, { persons = null } = {}) {
  const doc = await loadNote(user, id);
  if (persons && !persons.some((p) => String(p) === String(doc.person))) throw new ConductError(404, 'Note not found');
  if (!doc.attachment?.file) throw new ConductError(404, 'This note has no file.');
  return doc.attachment;
}
