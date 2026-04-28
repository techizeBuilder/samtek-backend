/** @format */
import mongoose from 'mongoose';

const userDocumentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ["AADHAAR", "PAN", "MARKSHEET_12", "PASSBOOK"]
  },
  fileUrl: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ["UPLOADED", "VERIFIED", "REJECTED"],
    default: "UPLOADED"
  }
}, {
  timestamps: true
});

export default mongoose.model('UserDocument', userDocumentSchema);
