// Feature 13 (2026-11-17): conduct notes — the scorecard's Behaviour, Discipline,
// Teamwork, Ownership and Safety. docs/client-features-2026-11/13-employee-scorecard-logic.md §5.
// A department head records a note with a written reason (today: Production via
// Manpower; HR for anyone). It counts only once HR verifies it; the writer can't
// verify their own. A verified note can be cancelled with a reason; nothing is deleted.
import mongoose from 'mongoose';
import ConductNote, { CONDUCT_TYPES, CONDUCT_SEVERITIES } from '../models/ConductNote.js';
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

/**
 * Records a note. personQuery (optional) limits who may be written about — Production
 * passes its own people. The note waits for HR.
 */
export async function recordNote(user, body = {}, { personQuery = null, attachment = null } = {}) {
  const personId = body.person;
  if (!mongoose.isValidObjectId(personId)) throw new ConductError(404, 'Person not found');
  const person = await User.findOne({ _id: personId, companyId: user.companyId }).select('fullName username departmentId role').lean();
  if (!person) throw new ConductError(404, 'Person not found');
  if (personQuery && !(await User.exists({ ...personQuery, _id: personId }))) {
    throw new ConductError(400, 'Only people in Production can be noted from here.');
  }
  if (String(personId) === String(user._id)) throw new ConductError(400, "You can't write a note about yourself.");
  const kind = body.kind === 'Appreciation' ? 'Appreciation' : 'Concern';
  if (!CONDUCT_TYPES.includes(body.type)) throw new ConductError(400, `Pick what it's about: ${CONDUCT_TYPES.join(', ')}.`);
  const severity = kind === 'Concern' ? body.severity : null;
  if (kind === 'Concern' && !CONDUCT_SEVERITIES.includes(severity)) throw new ConductError(400, 'Pick how serious it is: Minor, Major or Serious.');
  const date = String(body.date || '');
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw new ConductError(400, 'Enter the date it happened.');
  if (date > todayIndia()) throw new ConductError(400, "The date can't be in the future.");
  const reason = String(body.reason || '').trim();
  if (reason.length < 5) throw new ConductError(400, 'Write what happened. A note needs a written reason.');

  const doc = await ConductNote.create({
    company: user.companyId, person: person._id, personName: nameOf(person),
    department: departmentOf(person, await companyDepartments(user.companyId))?._id || null, // set on them, else their role's
    kind, type: body.type, severity, date, reason, attachment: attachment || null,
    recordedBy: user._id, recordedByName: await whoIs(user),
  });
  // A note HR writes also goes to the Company Admin, who can verify it when there's one HR person (18 Nov 2026).
  const verifiers = HR_ROLES.includes(user.role) ? [...HR_ROLES, 'Company Admin'] : HR_ROLES;
  await notify(() => notificationService.notifyRoles(verifiers, {
    title: `Conduct note to verify — ${doc.personName}`,
    message: `${doc.recordedByName || 'Someone'} noted ${kind === 'Concern' ? `a ${severity} ${doc.type.toLowerCase()} concern` : `an appreciation (${doc.type.toLowerCase()})`} on ${date}: ${reason}`,
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
export async function verifyNote(user, id) {
  const doc = await loadNote(user, id, 'Pending');
  if (String(doc.recordedBy) === String(user._id)) throw new ConductError(403, 'Someone else must verify a note you wrote.');
  Object.assign(doc, { status: 'Verified', decidedBy: user._id, decidedByName: await whoIs(user), decidedAt: new Date() });
  await doc.save();
  await tellWriter(doc, `Conduct note verified — ${doc.personName}`, `${doc.decidedByName || 'HR'} verified your note of ${doc.date} on ${doc.personName}.`); // the Company Admin may verify too
  return doc;
}

/** HR rejects, saying why. It never counts. */
export async function rejectNote(user, id, reason) {
  const doc = await loadNote(user, id, 'Pending');
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
  if (person && mongoose.isValidObjectId(person)) q.person = person;
  if (persons) q.person = q.person ? (persons.some((p) => String(p) === String(q.person)) ? q.person : null) : { $in: persons };
  if (MONTH_RE.test(month)) q.date = { $gte: `${month}-01`, $lte: `${month}-31` };
  const s = String(search || '').trim();
  if (s) q.personName = new RegExp(esc(s), 'i');
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const [items, total, waiting] = await Promise.all([
    ConductNote.find(q).sort({ createdAt: -1 }).skip((pg - 1) * lim).limit(lim).populate('department', 'name').lean(),
    ConductNote.countDocuments(q),
    ConductNote.countDocuments({ company: user.companyId, status: 'Pending', ...(persons ? { person: { $in: persons } } : {}) }),
  ]);
  return { items: items.map((n) => ({ ...n, attachment: n.attachment ? { name: n.attachment.name } : null })), total, page: pg, limit: lim, waiting };
}

/** A note's file, for someone allowed to see the note (persons limits like listNotes). */
export async function noteFile(user, id, { persons = null } = {}) {
  const doc = await loadNote(user, id);
  if (persons && !persons.some((p) => String(p) === String(doc.person))) throw new ConductError(404, 'Note not found');
  if (!doc.attachment?.file) throw new ConductError(404, 'This note has no file.');
  return doc.attachment;
}
