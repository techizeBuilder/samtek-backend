// Purchaser score (2026-10-13, blueprint §13 — services/purchaserScoreService.js).
// The Company Admin sees every purchaser; anyone else only themselves (user decision).
import mongoose from 'mongoose';
import { computePurchaserScores, monthRange, purchaserWeightsOf } from '../services/purchaserScoreService.js';
import { getOrCreateSettings } from './purchaseSettingsController.js';

export const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
export const isScoreAdmin = (user) => ADMIN_ROLES.includes(user?.role);

async function namesOf(ids) {
  const users = await mongoose.model('User').find({ _id: { $in: ids } }).select('fullName username role').lean();
  return new Map(users.map(u => [String(u._id), { name: u.fullName || u.username || 'User', role: u.role || '' }]));
}

// GET /api/purchaser-scores?month=YYYY-MM
export const getPurchaserScores = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const admin = isScoreAdmin(req.user);
    const settings = await getOrCreateSettings(companyId);
    const scores = await computePurchaserScores({ companyId, userIds: admin ? null : [String(req.user._id)], month: req.query.month, settings });
    const names = await namesOf([...scores.keys()]);
    const rows = [...scores.entries()].map(([userId, s]) => ({ userId, ...(names.get(userId) || { name: 'User', role: '' }), ...s }))
      .sort((a, b) => (b.month.score ?? -1) - (a.month.score ?? -1));
    res.json({ success: true, month: monthRange(req.query.month).key, weights: purchaserWeightsOf(settings), admin, rows });
  } catch (err) {
    console.error('Listing purchaser scores failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/purchaser-scores/:userId?month=YYYY-MM — one purchaser, with evidence.
export const getPurchaserScore = async (req, res) => {
  try {
    const { userId } = req.params;
    const self = userId === 'me' || String(userId) === String(req.user._id);
    if (!self && !isScoreAdmin(req.user)) return res.status(403).json({ success: false, message: 'You can only see your own purchaser score.' });
    const target = self ? String(req.user._id) : userId;
    if (!mongoose.isValidObjectId(target)) return res.status(404).json({ success: false, message: 'User not found' });
    const settings = await getOrCreateSettings(req.user.companyId);
    const scores = await computePurchaserScores({ companyId: req.user.companyId, userIds: [target], month: req.query.month, settings, withEvidence: true });
    const names = await namesOf([target]);
    const s = scores.get(target) || null;
    res.json({ success: true, month: monthRange(req.query.month).key, weights: purchaserWeightsOf(settings), userId: target, ...(names.get(target) || { name: 'User', role: '' }), score: s });
  } catch (err) {
    console.error('Reading a purchaser score failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
