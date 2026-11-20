// Feature 10 (2026-11-13): HR's Manpower Score page — every department's scored
// people, and incentives. docs/client-features-2026-11/10-performance-score-logic.md
import { scores, personScore } from '../services/score/scoreService.js';
import { IncentiveError, approveIncentive, rejectIncentive, giveIncentive, listIncentives, personIncentives, incentiveCapView } from '../services/incentiveService.js';

const fail = (res, err) => {
  if (err instanceof IncentiveError) return res.status(err.status).json({ success: false, message: err.message });
  console.error('[ManpowerScore]', err);
  return res.status(500).json({ success: false, message: err.message });
};

// GET /api/manpower-score?month=&from=&to=&department=&search=&page=&limit=&sort=
export const getManpowerScores = async (req, res) => {
  try { res.json({ success: true, ...(await scores(req.user.companyId, req.query)) }); } catch (err) { fail(res, err); }
};

// GET /api/manpower-score/person/:id?month=
export const getManpowerScorePerson = async (req, res) => {
  try {
    const s = await personScore(req.user.companyId, req.params.id, req.query);
    if (!s) return res.status(404).json({ success: false, message: 'Person not found' });
    res.json({ success: true, ...s, ...(await personIncentives(req.user, req.params.id, req.query.incPage)) });
  } catch (err) { fail(res, err); }
};

// GET /api/manpower-score/incentives?status=&month=&search=&page=
export const getIncentives = async (req, res) => {
  try { res.json({ success: true, ...(await listIncentives(req.user, req.query)) }); } catch (err) { fail(res, err); }
};

export const approveIncentiveRequest = async (req, res) => {
  try { res.json({ success: true, data: await approveIncentive(req.user, req.params.id, req.body || {}) }); } catch (err) { fail(res, err); }
};

export const rejectIncentiveRequest = async (req, res) => {
  try { res.json({ success: true, data: await rejectIncentive(req.user, req.params.id, req.body?.reason) }); } catch (err) { fail(res, err); }
};

// GET /api/manpower-score/incentives/cap?person=&month=&except= — feature 15: the cap and
// what's already approved that month, for the Give / Approve box.
export const getIncentiveCap = async (req, res) => {
  try { res.json({ success: true, data: await incentiveCapView(req.user, req.query.person, req.query.month, req.query.except) }); } catch (err) { fail(res, err); }
};

// POST /api/manpower-score/incentives — HR gives one directly
export const giveIncentiveDirect = async (req, res) => {
  try { res.status(201).json({ success: true, data: await giveIncentive(req.user, req.body || {}) }); } catch (err) { fail(res, err); }
};
