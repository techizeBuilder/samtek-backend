// One per company: its attendance device login and where the sync has got to
// (2026-11-11). Its own record rather than fields on Company, because company routes
// return the whole company. The login is encrypted and hidden by default.
import mongoose from 'mongoose';

const deviceSyncSettingSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
  corporateIdEnc: { type: String, default: null, select: false },
  usernameEnc: { type: String, default: null, select: false },
  passwordEnc: { type: String, default: null, select: false },
  loginSaved: { type: Boolean, default: false },
  // Set when the device refuses the login. The sync stops for this company until
  // the login is saved again, so we can't lock the client's account by retrying.
  loginRefused: { type: Boolean, default: false },
  // MMyyyy$ID, the API's marker for "punches after this one".
  bookmark: { type: String, default: null },
  // YYYY-MM-DD. Attendance isn't built for days before this.
  syncFrom: { type: String, default: null },
  lastSyncAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
  lastErrorAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('DeviceSyncSetting', deviceSyncSettingSchema);
