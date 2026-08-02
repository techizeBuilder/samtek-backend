import mongoose from 'mongoose';

const adminSettingsSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true
  },

  // ─── SMTP / Email Settings ─────────────────────────────────────
  // Each entry is one department's real mailbox. `department` picks which
  // module (quotations, payment reminders, PO/RFQ, HR, etc.) sends through it —
  // see server/config/mailAccounts.js for where each department is used.
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

  // ─── Lead Settings ─────────────────────────────────────────────
  leadStages: [{
    name: { type: String, required: true },
    order: { type: Number, default: 0 }
  }],

  leadSources: [{
    name: { type: String, required: true }
  }],

  businessTypes: [{
    name: { type: String, required: true }
  }],

  documentTypes: [{
    name: { type: String, required: true }
  }],

  leadRejectReasons: [{
    label: { type: String, required: true },
    order: { type: Number, default: 0 }
  }],

  // ─── Quotation Settings ────────────────────────────────────────
  termsAndConditions: [{
    heading: { type: String, required: true },
    text: { type: String, required: true }
  }],

  additionalCharges: [{
    name: { type: String, required: true },
    price: { type: Number, default: 0 },
    gst: { type: Number, default: 18 }
  }],

  quotationNotes: [{
    text: { type: String, required: true }
  }],

  // Quotation numbering format — admin-configurable prefix/suffix/separator/
  // financial-year placement used to build "Quotation No" across preview/PDF/print.
  // Kept as a list (matches the CRUD pattern used everywhere else); the most
  // recently added entry is treated as the active format.
  quotationNumberSettings: [{
    prefix: { type: String, default: '' },
    suffix: { type: String, default: '' },
    bifurcateWith: { type: String, enum: ['-', '/', '_', 'None'], default: '-' },
    financialYearPosition: { type: String, enum: ['none', 'before_prefix', 'after_prefix'], default: 'none' },
  }],

  // ─── Dispatch Settings ─────────────────────────────────────────
  dispatchChecklist: [{
    label: { type: String, required: true },
    order: { type: Number, default: 0 }
  }],

  // ─── HRMS: Upload Document Settings ─────────────────────────────
  // The list of documents an HRMS employee is required to upload on their
  // "Documents" profile tab. Admin-configurable — replaces what used to be
  // a hardcoded 4-item list in the frontend.
  hrmsDocumentTypes: [{
    key: { type: String, required: true },       // stable identifier stored on UserDocument.type
    label: { type: String, required: true },      // display name
    description: { type: String, default: '' },
    order: { type: Number, default: 0 }
  }],

}, { timestamps: true });

export default mongoose.model('AdminSettings', adminSettingsSchema);
