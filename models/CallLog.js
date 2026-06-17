import mongoose from 'mongoose';

const callLogSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead'
  },

  // IVR / Acefone fields
  callId: { type: String, default: '' },
  uuid: { type: String, default: '' },
  direction: {
    type: String,
    enum: ['inbound', 'outbound', 'clicktocall'],
    default: 'inbound'
  },
  status: { type: String, default: '' },
  description: { type: String, default: '' },
  recordingUrl: { type: String, default: '' },
  service: { type: String, default: 'Inbound' },

  // Numbers
  clientNumber: { type: String, default: '' },
  didNumber: { type: String, default: '' },
  agentNumber: { type: String, default: '' },
  agentName: { type: String, default: '' },

  // Timestamps
  callDate: { type: Date },
  callStartStamp: { type: Date },
  callEndStamp: { type: Date },

  // Duration
  callDuration: { type: Number, default: 0 },     // total seconds
  answeredSeconds: { type: Number, default: 0 },  // billable seconds
  minutesConsumed: { type: Number, default: 0 },

  hangupCause: { type: String, default: '' },
  reason: { type: String, default: '' },

  // Source
  source: {
    type: String,
    enum: ['IVR', 'ClickToCall', 'Manual'],
    default: 'IVR'
  }

}, { timestamps: true });

callLogSchema.index({ companyId: 1, callId: 1 }, { unique: true });
callLogSchema.index({ leadId: 1 });
callLogSchema.index({ clientNumber: 1 });

export default mongoose.model('CallLog', callLogSchema);
