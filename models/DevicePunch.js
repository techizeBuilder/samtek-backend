// One punch from the attendance device (2026-11-11,
// docs/client-features-2026-11/02b-device-sync-logic.md). Kept even when the code
// matches nobody, so HR can link it later without losing it.
import mongoose from 'mongoose';

const devicePunchSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  code: { type: String, required: true, trim: true },
  name: { type: String, default: '' },
  punchAt: { type: Date, required: true },
  // India date of the punch, YYYY-MM-DD.
  date: { type: String, required: true },
  // M_Flag = M: appears to be typed by hand in the device software.
  byHand: { type: Boolean, default: false },
  deviceId: { type: String, default: '' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

devicePunchSchema.index({ companyId: 1, code: 1, punchAt: 1 }, { unique: true });
devicePunchSchema.index({ companyId: 1, date: 1 });
devicePunchSchema.index({ user: 1, punchAt: 1 });

export default mongoose.model('DevicePunch', devicePunchSchema);
