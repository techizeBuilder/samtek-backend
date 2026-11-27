// Feature 13 (2026-11-17): the employee scorecard's conduct notes and settings.
// docs/client-features-2026-11/13-employee-scorecard-logic.md §5, §14.
//   Production (Manpower): notes about its own people — record (edit), list (view)
//   HR (Employee Performance): notes about anyone — record (add), verify / reject /
//     cancel (edit), list (view); reads the settings in force
//   Company Admin: saves a settings version
import User from '../models/User.js';
import mongoose from 'mongoose';
import { ConductError, recordNote, verifyNote, rejectNote, cancelNote, listNotes, noteFile, getRules, saveRules, warningState } from '../services/conductNoteService.js';
import { SettingsError, saveSettings, settingsView } from '../services/score/scorecardSettings.js';
import { productionDepartmentIds, eligiblePeopleQuery } from '../services/productionTeamService.js';
import { sendConductFile } from '../middleware/conductNoteUpload.js';

const fail = (res, err) => {
  if (err instanceof ConductError || err instanceof SettingsError) return res.status(err.status).json({ success: false, message: err.message });
  console.error('[Scorecard]', err);
  return res.status(500).json({ success: false, message: err.message });
};

// Production's people (any, for reading) — department-based, so someone who left still shows with their notes.
async function productionPeople(companyId) {
  return (await User.find({ companyId, departmentId: { $in: await productionDepartmentIds(companyId) } }).select('_id').lean()).map((u) => u._id);
}

/** The people Production may see on its own pages: its departments. */
export async function productionUserQuery(companyId) {
  return { departmentId: { $in: await productionDepartmentIds(companyId) } };
}

// ── Production → Manpower ────────────────────────────────────────────────────

// GET /api/production-mfg/conduct-notes?status=&person=&month=&search=&page=
export const getProductionConductNotes = async (req, res) => {
  try { res.json({ success: true, ...(await listNotes(req.user, req.query, { persons: await productionPeople(req.user.companyId) })) }); } catch (err) { fail(res, err); }
};

// POST /api/production-mfg/conduct-notes (multipart or JSON)
export const postProductionConductNote = async (req, res) => {
  try {
    const doc = await recordNote(req.user, req.body || {}, { personQuery: await eligiblePeopleQuery(req.user.companyId), attachment: req.conductAttachment });
    res.status(201).json({ success: true, data: doc });
  } catch (err) { fail(res, err); }
};

// GET /api/production-mfg/conduct-notes/:id/file
export const getProductionConductFile = async (req, res) => {
  try { sendConductFile(res, await noteFile(req.user, req.params.id, { persons: await productionPeople(req.user.companyId) })); } catch (err) { fail(res, err); }
};

// ── HR → Employee Performance ────────────────────────────────────────────────

export const getHrConductNotes = async (req, res) => {
  try { res.json({ success: true, ...(await listNotes(req.user, req.query)) }); } catch (err) { fail(res, err); }
};

// HR may record immediate action (a concern with no warning first), for the Company Admin to approve (feature 24).
export const postHrConductNote = async (req, res) => {
  try { res.status(201).json({ success: true, data: await recordNote(req.user, req.body || {}, { attachment: req.conductAttachment, canImmediate: true }) }); } catch (err) { fail(res, err); }
};

// ── Feature 24: warnings ─────────────────────────────────────────────────────

// GET / PUT /api/manpower-score/warning-rules — HR (view / edit) and the Company Admin.
export const getWarningRules = async (req, res) => {
  try { res.json({ success: true, data: await getRules(req.user.companyId) }); } catch (err) { fail(res, err); }
};
export const putWarningRules = async (req, res) => {
  try { res.json({ success: true, data: await saveRules(req.user, req.body || {}) }); } catch (err) { fail(res, err); }
};

// A person's warnings per type in the last 3 months (the note dialog). persons limits to a set.
async function stateFor(req, persons = null) {
  const person = String(req.query.person || '');
  if (!mongoose.isValidObjectId(person) || !(await User.exists({ _id: person, companyId: req.user.companyId }))) throw new ConductError(404, 'Person not found');
  if (persons && !persons.some((p) => String(p) === person)) throw new ConductError(404, 'Person not found');
  return warningState(req.user.companyId, person);
}
// GET /api/manpower-score/conduct-notes/warnings?person=
export const getHrWarningState = async (req, res) => {
  try { res.json({ success: true, data: await stateFor(req) }); } catch (err) { fail(res, err); }
};
// GET /api/production-mfg/conduct-notes/warnings?person= — Production's own people only.
export const getProductionWarningState = async (req, res) => {
  try { res.json({ success: true, data: await stateFor(req, await productionPeople(req.user.companyId)) }); } catch (err) { fail(res, err); }
};

export const verifyConductNote = async (req, res) => {
  try { res.json({ success: true, data: await verifyNote(req.user, req.params.id) }); } catch (err) { fail(res, err); }
};

export const rejectConductNote = async (req, res) => {
  try { res.json({ success: true, data: await rejectNote(req.user, req.params.id, req.body?.reason) }); } catch (err) { fail(res, err); }
};

export const cancelConductNote = async (req, res) => {
  try { res.json({ success: true, data: await cancelNote(req.user, req.params.id, req.body?.reason) }); } catch (err) { fail(res, err); }
};

export const getHrConductFile = async (req, res) => {
  try { sendConductFile(res, await noteFile(req.user, req.params.id)); } catch (err) { fail(res, err); }
};

// ── Settings ─────────────────────────────────────────────────────────────────

// GET /api/scorecard-settings?page= — the settings in force, any waiting version, and the history
export const getScorecardSettings = async (req, res) => {
  try { res.json({ success: true, ...(await settingsView(req.user.companyId, req.query)) }); } catch (err) { fail(res, err); }
};

// PUT /api/scorecard-settings { effectiveFrom, points, deductions } — Company Admin
export const putScorecardSettings = async (req, res) => {
  try { res.status(201).json({ success: true, data: await saveSettings(req.user, req.body || {}) }); } catch (err) { fail(res, err); }
};
