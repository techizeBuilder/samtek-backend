"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const supplierSchema = new mongoose_1.default.Schema({
    supplierCode: {
        type: String,
        required: true,
        unique: true
    },
    supplierName: {
        type: String,
        required: true
    },
    contactPerson: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true
    },
    phone: {
        type: String,
        required: true
    },
    alternatePhone: {
        type: String
    },
    address: {
        street: {
            type: String
        },
        city: {
            type: String
        },
        state: {
            type: String
        },
        zipCode: {
            type: String
        },
        country: {
            type: String,
            default: 'India'
        }
    },
    gstNumber: {
        type: String
    },
    panNumber: {
        type: String
    },
    bankDetails: {
        accountNumber: String,
        accountName: String,
        bankName: String,
        branchName: String,
        ifscCode: String
    },
    paymentTerms: {
        type: String,
        default: 'Net 30'
    },
    unit: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    supplierType: {
        type: String,
        enum: ['Raw Material', 'Services', 'Equipment', 'Consumables'],
        default: 'Raw Material'
    },
    rating: {
        type: Number,
        min: 1,
        max: 5,
        default: 3
    },
    notes: {
        type: String
    },
    openingBalance: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    entityType: {
        type: String,
        enum: ['Individual', 'HUF', 'Company', 'Firm', 'Others'],
        default: 'Others'
    },
    tdsSection: {
        type: String,
        enum: ['194C', '194J', '194Q', '206C_1H', 'None'],
        default: 'None'
    }
}, {
    timestamps: true
});
supplierSchema.pre('validate', function () {
    if (!this.supplierCode) {
        this.supplierCode = `SUPP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    }
});
exports.default = mongoose_1.default.model('Supplier', supplierSchema);
