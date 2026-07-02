import mongoose from 'mongoose';

const apiSettingsSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true
  },

  // ─── IndiaMART Settings ───────────────────────────────────────
  indiamart: {
    enabled: { type: Boolean, default: false },
    sellerMobile: { type: String, default: '' },
    authKey: { type: String, default: '' },
    accounts: [{
      apiName: { type: String, default: '' },
      sellerMobile: { type: String, default: '' },
      authKey: { type: String, default: '' },
      lastSyncedAt: { type: Date }
    }],
    assignmentRule: {
      type: String,
      enum: ['round_robin', 'random'],
      default: 'round_robin'
    },
    assignedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastAssignedIndex: { type: Number, default: 0 },
    lastSyncedAt: { type: Date }
  },

  // ─── IVR / Acefone Settings ───────────────────────────────────
  ivr: {
    enabled: { type: Boolean, default: false },
    apiKey: { type: String, default: '' },
    callerID: { type: String, default: '' },  // outbound caller ID shown to customer (e.g. 9240246800)
    assignmentRule: {
      type: Number,
      enum: [1, 2, 3],
      default: 2
    },
    assignedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastAssignedIndex: { type: Number, default: 0 },
    lastSyncedAt: { type: Date }
  },

  // ─── Website Webhook Settings ─────────────────────────────────
  website: {
    enabled: { type: Boolean, default: false },
    apiKey: { type: String, default: '' },
    assignedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  }

}, { timestamps: true });

export default mongoose.model('ApiSettings', apiSettingsSchema);
