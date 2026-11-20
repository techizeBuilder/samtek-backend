// Delivery estimate (2026-11-18): the Company Admin's settings. docs/delivery-estimate/02-plan.md, slice 1.
import mongoose from 'mongoose';
import DeliveryEstimateSettings, { ESTIMATE_DEFAULTS } from '../../models/DeliveryEstimateSettings.js';
import User from '../../models/User.js';

export class EstimateError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const FIELDS = {
  bufferPercent: { min: 0, max: 200, label: 'Buffer %' },
  bufferMinDays: { min: 0, max: 60, whole: true, label: 'Minimum buffer days' },
  packingDays: { min: 0, max: 30, whole: true, label: 'Packing days' },
  dispatchDays: { min: 0, max: 30, whole: true, label: 'Dispatch days' },
  travelDaysDefault: { min: 0, max: 60, whole: true, label: 'Usual travel days' },
};

/** The settings in force (the defaults until the Company Admin saves). */
export async function estimateSettings(companyId) {
  const s = await DeliveryEstimateSettings.findOne({ company: new mongoose.Types.ObjectId(String(companyId)) }).lean();
  if (!s) return { ...ESTIMATE_DEFAULTS, defaults: true };
  const out = {};
  for (const k of Object.keys(FIELDS)) out[k] = s[k] ?? ESTIMATE_DEFAULTS[k];
  return { ...out, defaults: false, savedByName: s.savedByName, savedAt: s.updatedAt };
}

export async function saveEstimateSettings(user, body = {}) {
  const set = {};
  for (const [k, f] of Object.entries(FIELDS)) {
    const x = Number(body[k]);
    if (!Number.isFinite(x) || x < f.min || x > f.max || (f.whole && !Number.isInteger(x))) {
      throw new EstimateError(400, `${f.label} must be ${f.whole ? 'a whole number' : 'a number'} from ${f.min} to ${f.max}.`);
    }
    set[k] = x;
  }
  const name = (await User.findById(user._id).select('fullName username').lean())?.fullName || user.username || ''; // req.user has no full name
  await DeliveryEstimateSettings.updateOne(
    { company: user.companyId },
    { $set: { ...set, savedBy: user._id, savedByName: name } },
    { upsert: true },
  );
  return estimateSettings(user.companyId);
}
