import mongoose from 'mongoose';

const adminSettingsSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true
  },

  // Note: SMTP / Email settings used to live here per-company. They are now
  // platform-wide, shared by every company — see models/GlobalSmtpSettings.js.

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

  // Points Sales must declare when marking a lead "Deal Won" (Leads.jsx),
  // later verified one-by-one by the Service team (DealVerifications.jsx).
  // `key` is the stable identifier stored under Order.salesChecklist[key] —
  // set once at creation and never changed by edits, so renaming/reordering
  // a point here never disturbs already-saved Orders' checklist data.
  salesChecklist: [{
    key: { type: String, required: true },
    label: { type: String, required: true },
    valueType: { type: String, enum: ['none', 'text', 'number'], default: 'text' },
    valueLabel: { type: String, default: '' },
    valuePlaceholder: { type: String, default: '' },
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

  // ─── HRMS: Role Setting ──────────────────────────────────────────
  // Assignable role names shown in Add User's Role dropdown. Seeded once
  // (on first fetch) with every role already built into the system
  // (isBuiltIn: true — protected from rename/delete since those exact
  // names are hardcoded across Sidebar/permissions/route-guards elsewhere).
  // Only custom roles added here (isBuiltIn: false) are editable/deletable.
  // Feature 34 (26 Nov 2026): a custom role is a cut-down version of one built-in role (baseRole):
  // the person's real role is the base role, their permissions never beyond `allowed` (the same
  // shape as permissions.modules). services/access/customRoles.js
  roles: [{
    name: { type: String, required: true, trim: true },
    isBuiltIn: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    baseRole: { type: String, default: '' },
    allowed: { type: [mongoose.Schema.Types.Mixed], default: [] },
    needsApproval: { type: Boolean, default: false },
  }],

  // Feature 28 (24 Nov 2026): set once this company's packing checklist, HRMS document types and
  // custom roles were copied from the platform lists (ids and keys kept). From then on they are
  // this company's own (Company Admin), and an empty list stays empty.
  listsCopiedAt: { type: Date, default: null },

}, { timestamps: true });

export default mongoose.model('AdminSettings', adminSettingsSchema);
