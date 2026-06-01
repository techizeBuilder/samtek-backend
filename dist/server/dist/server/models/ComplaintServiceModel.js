"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const ticketSchema = new mongoose_1.default.Schema({
    // --- 1. Core Identification ---
    tokenId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    source: {
        type: String,
        enum: ['Call', 'WhatsApp', 'Website', 'Sales Team'],
        default: 'Website'
    },
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: "Company",
        required: true
    },
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    // --- 2. Customer Information ---
    customer: {
        name: { type: String, required: true },
        mobileNumber: { type: String, required: true, index: true },
        email: { type: String },
        address: { type: String, required: true }
    },
    // --- 3. Machine & Issue Details ---
    machine: {
        machineType: { type: String, required: true },
        model: { type: String },
        serialNumber: { type: String },
        // 🔥 NEW: Added Warranty and AMC Status
        warrantyStatus: { type: String, default: 'Unknown' },
        amcStatus: { type: String, default: 'Unknown' }
    },
    issue: {
        issueType: {
            type: String,
            enum: ['Breakdown', 'Performance Issue', 'Installation', 'Training'],
            required: true
        },
        description: { type: String }
    },
    // --- 4. Priority & SLA ---
    priority: {
        level: {
            type: String,
            enum: ['Low', 'Medium', 'High'],
            default: 'Low'
        }
    },
    sla: {
        responseDeadline: { type: Date },
        resolutionDeadline: { type: Date },
        isBreached: { type: Boolean, default: false }
    },
    // --- 5. Assignment ---
    assignment: {
        technicianId: {
            type: mongoose_1.default.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true
        },
        assignedAt: { type: Date },
        visitScheduledAt: { type: Date }
    },
    // --- 6. Service Execution ---
    visitHistory: [
        {
            technicianId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User' },
            technicianName: { type: String },
            travelStart: { type: Date },
            visitStart: { type: Date },
            visitEnd: { type: Date },
            workDoneDetails: { type: String },
            partsUsed: [
                {
                    item: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Item', required: true },
                    quantity: { type: Number, default: 1, min: 1 }
                }
            ],
            media: [
                {
                    url: { type: String },
                    type: { type: String, enum: ['image', 'video'] }
                }
            ],
            visitStatus: {
                type: String,
                enum: ['Completed', 'Incomplete', 'Customer Rejected'],
                default: 'Completed'
            }
        }
    ],
    // --- 7. Status Workflow ---
    status: {
        type: String,
        enum: [
            'Unassigned',
            'Pending',
            'In Progress',
            'Pending Approval',
            'Resolved',
            'Reopened',
            'Cancelled',
            'Closed'
        ],
        default: 'Unassigned',
        index: true
    },
    // --- 8. Customer Closure & Feedback ---
    closure: {
        customerToken: { type: String, index: true },
        tokenExpiresAt: { type: Date },
        verificationEmailSent: { type: Boolean, default: false },
        digitalSignatureUrl: { type: String },
        isSatisfied: { type: Boolean },
        feedbackComments: { type: String },
        resolutionTimeMinutes: { type: Number },
        closedAt: { type: Date }
    },
    // --- 9. Audit Trail ---
    auditLog: [
        {
            action: { type: String },
            performedBy: {
                userId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User' },
                role: { type: String }
            },
            previousStatus: { type: String },
            newStatus: { type: String },
            timestamp: { type: Date, default: Date.now }
        }
    ]
}, { timestamps: true });
ticketSchema.index({ status: 1, 'priority.level': 1 });
ticketSchema.index({ status: 1, 'sla.isBreached': 1 });
ticketSchema.index({ 'assignment.technicianId': 1, status: 1 });
exports.default = mongoose_1.default.model('ServiceTicket', ticketSchema);
