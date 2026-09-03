import mongoose from 'mongoose';

// Platform-wide "Admin Settings > General" data, configured once by Super
// Admin and shared by every company. Super Admin isn't tied to any one
// company (see GlobalSalesChecklist.js / GlobalSmtpSettings.js for the same
// reasoning) — these used to live on the per-company AdminSettings doc, keyed
// off the Super Admin's own incidental companyId, so only that one company's
// users ever saw what Super Admin configured here. Singleton collection:
// exactly one document, no companyId.
const globalAdminSettingsSchema = new mongoose.Schema({
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

  quotationNumberSettings: [{
    prefix: { type: String, default: '' },
    suffix: { type: String, default: '' },
    bifurcateWith: { type: String, enum: ['-', '/', '_', 'None'], default: '-' },
    financialYearPosition: { type: String, enum: ['none', 'before_prefix', 'after_prefix'], default: 'none' },
  }],

  dispatchChecklist: [{
    label: { type: String, required: true },
    order: { type: Number, default: 0 }
  }],

  hrmsDocumentTypes: [{
    key: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: '' },
    order: { type: Number, default: 0 }
  }],

  roles: [{
    name: { type: String, required: true, trim: true },
    isBuiltIn: { type: Boolean, default: false },
    order: { type: Number, default: 0 }
  }],
}, { timestamps: true });

export default mongoose.model('GlobalAdminSettings', globalAdminSettingsSchema);
