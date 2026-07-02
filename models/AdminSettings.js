import mongoose from 'mongoose';

const adminSettingsSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true
  },

  // ─── SMTP / Email Settings ─────────────────────────────────────
  smtp: [{
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

}, { timestamps: true });

export default mongoose.model('AdminSettings', adminSettingsSchema);
