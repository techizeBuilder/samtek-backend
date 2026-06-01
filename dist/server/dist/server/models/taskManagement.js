"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const TaskSchema = new mongoose_1.default.Schema({
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    assignedTo: [{
            type: mongoose_1.default.Schema.Types.ObjectId,
            ref: "User",
            required: true // Support for Single/Multiple users 
        }],
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: "Company",
        required: true // Enforces that every task must belong to a company
    },
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: "User",
        required: true // To track creation authority
    },
    department: {
        type: String,
        required: true
    },
    priority: {
        type: String,
        enum: ["Low", "Medium", "High"],
        default: "Medium"
    },
    status: {
        type: String,
        enum: ["Pending", "In Progress", "Hold", "Completed"],
        default: "Pending"
    },
    taskType: {
        type: String,
        enum: ["One Time", "Running Work", "Surprise Work"],
        required: true
    },
    file: {
        type: String
    },
    dueDate: {
        type: Date,
        required: true
    },
    reminder: {
        type: Boolean,
        default: false
    },
    // Discussion Thread Component 
    comments: [{
            user: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "User" },
            text: String,
            createdAt: { type: Date, default: Date.now }
        }],
    // Activity Log / Audit Trail 
    activityLog: [{
            action: String,
            performedBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "User" },
            timestamp: { type: Date, default: Date.now }
        }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});
// Implementation of "Save & Lock" Mechanism 
// This pre-save hook prevents changes to core fields after the initial creation
TaskSchema.pre('save', function () {
    // We remove the 'next' parameter entirely
    if (!this.isNew) {
        // List of fields that are locked after creation per Source 78
        const lockedFields = ['title', 'description', 'taskType', 'createdBy', 'dueDate'];
        for (const field of lockedFields) {
            if (this.isModified(field)) {
                // Throwing an error here is the correct way to halt the save process
                throw new Error(`The field '${field}' is locked and cannot be edited after creation.`);
            }
        }
    }
});
exports.default = mongoose_1.default.model('Task', TaskSchema);
