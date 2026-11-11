import mongoose from 'mongoose';

// A single global document — there is exactly one ApiSettings record for the
// whole software, not one per company (see docs/global-api-settings-2026-11.md).
// Each integration below instead carries its own `assignedCompanyIds`: the
// subset of companies that should receive the leads/candidates/call-logs that
// integration produces. A webhook with an empty assignedCompanyIds has nowhere
// to deliver leads and is treated as not-yet-configured by its receiver.
const companyRef = { type: mongoose.Schema.Types.ObjectId, ref: 'Company' };

const apiSettingsSchema = new mongoose.Schema({
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
    assignedCompanyIds: [companyRef],
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
    assignedCompanyIds: [companyRef],
    lastAssignedIndex: { type: Number, default: 0 },
    lastSyncedAt: { type: Date }
  },

  // ─── Website Webhook Settings ─────────────────────────────────
  website: {
    enabled: { type: Boolean, default: false },
    apiKey: { type: String, default: '' },
    assignedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    assignedCompanyIds: [companyRef]
  },

  // ─── Google Ads Lead Form Webhook Settings ─────────────────────
  // webhookKey doubles as both the ?q= tenant identifier (our own
  // convention) AND the "google_key" shared secret Google Ads echoes
  // back in every payload for its own verification handshake.
  googleAds: {
    enabled: { type: Boolean, default: false },
    webhookKey: { type: String, default: '' },
    assignedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    assignedCompanyIds: [companyRef],
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
    assignedCompanyIds: [companyRef],
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
