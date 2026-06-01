"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const cutoffTimeSchema = new mongoose_1.default.Schema({
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    unitHeadId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    cutoffTime: {
        type: String, // Format: "HH:MM" (24-hour format, e.g., "15:00" for 3:00 PM)
        required: true,
        validate: {
            validator: function (time) {
                // Validate HH:MM format
                const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
                return timeRegex.test(time);
            },
            message: 'Cutoff time must be in HH:MM format (24-hour)'
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    description: {
        type: String,
        maxLength: 200,
        default: ''
    },
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    updatedBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});
// Ensure only one cutoff time per company
cutoffTimeSchema.index({ companyId: 1 }, { unique: true });
// Index for faster queries
cutoffTimeSchema.index({ companyId: 1, isActive: 1 });
cutoffTimeSchema.index({ unitHeadId: 1 });
// Instance method to check if current time is past cutoff
cutoffTimeSchema.methods.isPastCutoff = function (currentTime = new Date()) {
    const [hours, minutes] = this.cutoffTime.split(':').map(Number);
    const cutoffDate = new Date();
    cutoffDate.setHours(hours, minutes, 0, 0);
    const currentDate = new Date(currentTime);
    return currentDate > cutoffDate;
};
// Static method to check if orders are allowed for a company
cutoffTimeSchema.statics.canPlaceOrder = function (companyId) {
    return __awaiter(this, void 0, void 0, function* () {
        const cutoffSetting = yield this.findOne({
            companyId,
            isActive: true
        });
        if (!cutoffSetting) {
            // If no cutoff time set, orders are always allowed
            return {
                allowed: true,
                message: 'No cutoff time restrictions'
            };
        }
        const isPastCutoff = cutoffSetting.isPastCutoff();
        return {
            allowed: !isPastCutoff,
            message: isPastCutoff ?
                `Orders are not allowed after ${cutoffSetting.cutoffTime}` :
                `Orders allowed until ${cutoffSetting.cutoffTime}`,
            cutoffTime: cutoffSetting.cutoffTime,
            isPastCutoff
        };
    });
};
// Static method to get cutoff time for a company
cutoffTimeSchema.statics.getCutoffTime = function (companyId) {
    return __awaiter(this, void 0, void 0, function* () {
        return this.findOne({ companyId, isActive: true }).populate('unitHeadId', 'username fullName');
    });
};
exports.default = mongoose_1.default.model('CutoffTime', cutoffTimeSchema);
