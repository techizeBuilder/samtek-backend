import mongoose from 'mongoose';

const meetingSchema = new mongoose.Schema({
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  meetingType: {
    type: String,
    enum: ['Visit', 'Online'],
    default: 'Visit'
  },
  meetingDate: {
    type: Date,
    required: true
  },
  startTime: {
    type: String,
    required: true
  },
  endTime: {
    type: String
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  meetingWith: {
    type: String   // Contact person name (from lead)
  },
  purpose: {
    type: String,
    default: 'Sales'
  },
  // For Visit
  venue: {
    type: String
  },
  // For Online
  onlineMeetingUrl: {
    type: String
  },
  remarks: {
    type: String
  },
  sendInviteEmail: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

meetingSchema.index({ leadId: 1 });
meetingSchema.index({ companyId: 1 });

export default mongoose.model('Meeting', meetingSchema);
