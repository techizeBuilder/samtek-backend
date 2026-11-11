// The device's own result for one code on one day (2026-11-11). Attendance is built
// from these. Kept even when the code matches nobody, so linking a code later can
// fill in the days already downloaded.
import mongoose from 'mongoose';

const deviceDaySchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  code: { type: String, required: true, trim: true },
  name: { type: String, default: '' },
  // YYYY-MM-DD, straight from the device row.
  date: { type: String, required: true },
  // HH:MM, or null for the device's --:--.
  inTime: { type: String, default: null },
  outTime: { type: String, default: null },
  workSeconds: { type: Number, default: 0 },
  overtimeSeconds: { type: Number, default: 0 },
  breakSeconds: { type: Number, default: 0 },
  lateSeconds: { type: Number, default: 0 },
  earlyOutSeconds: { type: Number, default: 0 },
  status: { type: String, default: '' },
  remark: { type: String, default: '' },
}, { timestamps: true });

deviceDaySchema.index({ companyId: 1, code: 1, date: 1 }, { unique: true });
deviceDaySchema.index({ companyId: 1, date: 1 });

export default mongoose.model('DeviceDay', deviceDaySchema);
