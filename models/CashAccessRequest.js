import mongoose from 'mongoose';

// Tracks a single 2FA attempt (Cash Password → email OTP) by an Accounts
// user to view one customer's Cash Amount. Short-lived — see
// cashAccessController.js for expiry/consumption rules.
const cashAccessRequestSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },

  otpHash: { type: String, required: true },
  otpExpiresAt: { type: Date, required: true },

  status: {
    type: String,
    enum: ['otp_pending', 'verified'],
    default: 'otp_pending',
  },
  verifiedAt: { type: Date, default: null },
}, { timestamps: true });

cashAccessRequestSchema.index({ requestedBy: 1, customerId: 1 });
// Auto-purge stale requests a day after creation — nothing needs them once expired.
cashAccessRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export default mongoose.model('CashAccessRequest', cashAccessRequestSchema);
