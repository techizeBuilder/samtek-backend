/** @format */
import mongoose from 'mongoose';

const userDocumentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: false
  },
  // Free-form key matching AdminSettings.hrmsDocumentTypes[].key — no longer
  // a fixed enum since the document type list is admin-configurable.
  type: {
    type: String,
    required: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ["UPLOADED", "VERIFIED", "REJECTED"],
    default: "UPLOADED"
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  remarks: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

export default mongoose.model('UserDocument', userDocumentSchema);
