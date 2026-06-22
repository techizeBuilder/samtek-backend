import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'order', 'inventory', 'customer', 'general', 'system',
      'lead', 'payment', 'production', 'dispatch', 'qc', 'store',
      'complaint', 'hrms', 'leave', 'attendance', 'payroll',
      'purchase', 'account', 'task', 'rd', 'marketing', 'mis'
    ],
    default: 'general'
  },
  icon: {
    type: String,
    default: 'bell'
  },
  targetRole: {
    type: String,
    enum: [
      null,                          // ✅ Personal notifications (targetUserId set hoga)
      'Superadmin', 'Super Admin',
      'Unit Head', 'Unit Manager',
      'Sales', 'Sales Head', 'Sales Employee',
      'Production', 'Production Head', 'Production Employee',
      'Manufacturing',
      'Packing', 'Packing Head', 'Packing Employee',
      'Dispatch', 'Dispatch Head', 'Dispatch Employee',
      'Accounts', 'Accounts Head', 'Account Employee',
      'Store', 'Store Head', 'Store Employee',
      'QC', 'QC Head', 'QC Employee',
      'Complaint Management Head', 'Complaint Management Employee',
      'HR-Admin', 'Manager', 'Employee', 'Company Admin',
      'Research & Development Head', 'Research Development Employee',
      'MIS Admin',
      'Marketing',
      'all'
    ],
    default: 'all'
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  targetUnit: {
    type: String,
    default: null
  },
  targetCompanyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isRead: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  }
}, {
  timestamps: true
});

// Index for efficient querying
notificationSchema.index({ targetRole: 1, createdAt: -1 });
notificationSchema.index({ targetUserId: 1, createdAt: -1 });
notificationSchema.index({ targetUnit: 1, createdAt: -1 });
notificationSchema.index({ targetCompanyId: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes for role-based filtering
notificationSchema.index({ targetRole: 1, targetUnit: 1, createdAt: -1 });
notificationSchema.index({ targetRole: 1, targetCompanyId: 1, createdAt: -1 });

// Virtual for checking if notification is read by specific user
notificationSchema.methods.isReadByUser = function(userId) {
  return this.isRead.some(read => read.userId.toString() === userId.toString());
};

// Static method to get unread count for user
notificationSchema.statics.getUnreadCount = async function(userId, userRole, userUnit = null, userCompanyId = null) {
  const globalRoles = ['Superadmin', 'Super Admin', 'MIS Admin'];
  const isGlobal = globalRoles.includes(userRole);

  let query;

  if (isGlobal) {
    // Global roles see all unread notifications
    query = { 'isRead.userId': { $ne: userId } };
  } else {
    // ✅ FIX 4: Same isolation logic as getUserNotifications
    // Personal notifs only count for owner; role notifs must match company/unit
    const companyOrUnitFilter = [];
    if (userUnit) companyOrUnitFilter.push({ targetUnit: userUnit });
    if (userCompanyId) companyOrUnitFilter.push({ targetCompanyId: userCompanyId });
    // Truly global broadcast (no company, no unit, not personal to someone else)
    companyOrUnitFilter.push({
      targetUnit: null,
      targetCompanyId: null,
      targetUserId: null
    });

    query = {
      $and: [
        {
          $or: [
            { targetRole: 'all' },
            { targetRole: userRole },
            { targetUserId: userId }
          ]
        },
        {
          // Personal notifs bypass company check; role/broadcast must match
          $or: [
            { targetUserId: userId },
            ...companyOrUnitFilter
          ]
        },
        { 'isRead.userId': { $ne: userId } }
      ]
    };
  }

  return await this.countDocuments(query);
};

export default mongoose.model('Notification', notificationSchema);