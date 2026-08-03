import mongoose from 'mongoose';

// Platform-wide SMTP mailboxes, configured once by Super Admin (Admin Settings >
// SMTP Settings) and shared by every company. One active entry per department —
// see server/config/mailAccounts.js for where each department is used.
// Singleton collection: exactly one document, no companyId.
const globalSmtpSettingsSchema = new mongoose.Schema({
  smtp: [{
    department: {
      type: String,
      enum: ['SALES', 'ACCOUNTS', 'PURCHASE', 'HR', 'INFO', 'CASH_ACCESS'],
      required: true,
    },
    provider: { type: String, enum: ['Gmail', 'Other'], default: 'Gmail' },
    mailServer: { type: String, default: 'smtp.gmail.com' },
    port: { type: Number, default: 587 },
    email: { type: String, default: '' },
    password: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  }],
}, { timestamps: true });

export default mongoose.model('GlobalSmtpSettings', globalSmtpSettingsSchema);
