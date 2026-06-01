"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const notificationSchema = new mongoose_1.default.Schema({
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
        enum: ['order', 'inventory', 'customer', 'general', 'system'],
        default: 'general'
    },
    icon: {
        type: String,
        default: 'bell'
    },
    targetRole: {
        type: String,
        enum: ['Superadmin', 'Unit Head', 'Unit Manager', 'Sales', 'Production', 'Manufacturing', 'Packing', 'Dispatch', 'Accounts', 'all'],
        default: 'all'
    },
    targetUserId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    targetUnit: {
        type: String,
        default: null
    },
    targetCompanyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        default: null
    },
    data: {
        type: mongoose_1.default.Schema.Types.Mixed,
        default: {}
    },
    isRead: [{
            userId: {
                type: mongoose_1.default.Schema.Types.ObjectId,
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
notificationSchema.methods.isReadByUser = function (userId) {
    return this.isRead.some(read => read.userId.toString() === userId.toString());
};
// Static method to get unread count for user
notificationSchema.statics.getUnreadCount = function (userId_1, userRole_1) {
    return __awaiter(this, arguments, void 0, function* (userId, userRole, userUnit = null, userCompanyId = null) {
        let query = {
            $and: [
                {
                    $or: [
                        { targetRole: 'all' },
                        { targetRole: userRole },
                        { targetUserId: userId }
                    ]
                },
                {
                    'isRead.userId': { $ne: userId }
                }
            ]
        };
        // Apply unit and company filtering based on role
        if (userRole === 'Superadmin') {
            // Super Admin sees all notifications - no additional filtering
        }
        else if (userRole === 'Unit Head' || userRole === 'Unit Manager' || userRole === 'Sales' ||
            userRole === 'Production' || userRole === 'Manufacturing' || userRole === 'Packing' ||
            userRole === 'Dispatch' || userRole === 'Accounts') {
            // Unit-based roles should only see notifications for their unit/company or global ones
            const unitCompanyFilters = [];
            // Add unit filtering if user has a unit
            if (userUnit) {
                unitCompanyFilters.push({ targetUnit: userUnit });
            }
            // Add company filtering if user has a company
            if (userCompanyId) {
                unitCompanyFilters.push({ targetCompanyId: userCompanyId });
            }
            // Add global notifications (no specific unit or company target)
            unitCompanyFilters.push({ targetUnit: null, targetCompanyId: null });
            if (unitCompanyFilters.length > 0) {
                query.$and.push({ $or: unitCompanyFilters });
            }
        }
        return yield this.countDocuments(query);
    });
};
exports.default = mongoose_1.default.model('Notification', notificationSchema);
