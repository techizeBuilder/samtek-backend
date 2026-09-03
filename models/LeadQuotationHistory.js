import mongoose from 'mongoose';

// One row per successful "Send Email" from Quotation.jsx — both the
// first-time send and every "Update Quotation" resend hit the same
// sendQuotationEmailHandler (salesController.js), which still overwrites
// Lead.quotation/quotationFinalAmount as before; this collection is purely
// an additive history log so past PDFs aren't lost, kept separate from Lead
// so the Lead document/API doesn't get heavier.
const leadQuotationHistorySchema = new mongoose.Schema({
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true,
    index: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  leadCode: {
    type: String,
    default: ''
  },
  quotation: {
    type: String,
    required: true
  },
  quotationFinalAmount: {
    type: Number,
    default: 0
  },
  sentTo: {
    type: String,
    default: ''
  },
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  sentAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

leadQuotationHistorySchema.index({ leadId: 1, sentAt: -1 });

export default mongoose.model('LeadQuotationHistory', leadQuotationHistorySchema);
