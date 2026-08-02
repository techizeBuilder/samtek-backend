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
  },

  // ─── Google Ads Lead Form Webhook Settings ─────────────────────
  // webhookKey doubles as both the ?q= tenant identifier (our own
  // convention) AND the "google_key" shared secret Google Ads echoes
  // back in every payload for its own verification handshake.
  googleAds: {
    enabled: { type: Boolean, default: false },
    webhookKey: { type: String, default: '' },
    assignedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastSyncedAt: { type: Date }
  },

  // ─── Facebook / Meta Lead Ads Webhook Settings ─────────────────
  // verifyToken: echoed back on Facebook's one-time GET handshake when the
  // webhook is subscribed in the App dashboard (hub.verify_token).
  // pageAccessToken: a long-lived Page token — the POST notification only
  // carries a leadgen_id, so this is required to actually fetch the lead's
  // field data back from the Graph API.
  facebook: {
    enabled: { type: Boolean, default: false },
    verifyToken: { type: String, default: '' },
    pageAccessToken: { type: String, default: '' },
    pageId: { type: String, default: '' },
    assignedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastSyncedAt: { type: Date }
  },

  // ─── WhatsApp Cloud API (Meta) Settings ─────────────────────────
  // accessToken must be a permanent System User token (not the 24h test
  // token from the Meta dashboard) — used as Authorization: Bearer ...
  // when POSTing to graph.facebook.com/<ver>/<phoneNumberId>/messages.
  // Free-text sends only succeed inside a customer's 24h service window;
  // outside it, Meta requires an approved message Template instead.
  whatsapp: {
    enabled: { type: Boolean, default: false },
    phoneNumberId: { type: String, default: '' },
    accessToken: { type: String, default: '' },
    lastSyncedAt: { type: Date }
  }

}, { timestamps: true });

export default mongoose.model('ApiSettings', apiSettingsSchema);
