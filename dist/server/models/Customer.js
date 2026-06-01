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
const customerSchema = new mongoose_1.default.Schema({
    // Basic Information
    customerCode: {
        type: String,
        unique: true,
        sparse: true // Allows null values but enforces uniqueness for non-null values
    },
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        maxlength: [100, 'Name cannot exceed 100 characters']
    },
    contactPerson: {
        type: String,
        trim: true,
        maxlength: [50, 'Contact person cannot exceed 50 characters']
    },
    designation: {
        type: String,
        trim: true,
        maxlength: [50, 'Designation cannot exceed 50 characters']
    },
    category: {
        type: String,
        required: [true, 'Category is required'],
        enum: {
            values: ['Distributor', 'Retailer', 'Wholesaler', 'End User'],
            message: 'Category must be one of: Distributor, Retailer, Wholesaler, End User'
        },
        default: 'Distributor'
    },
    categoryNote: {
        type: String,
        trim: true,
        maxlength: [200, 'Category note cannot exceed 200 characters']
    },
    active: {
        type: String,
        required: [true, 'Active status is required'],
        enum: {
            values: ['Yes', 'No'],
            message: 'Active must be either Yes or No'
        },
        default: 'Yes'
    },
    // Contact Information
    mobile: {
        type: String,
        required: [true, 'Mobile number is required'],
        validate: {
            validator: function (v) {
                return /^[0-9]{10}$/.test(v); // 10 digit mobile number
            },
            message: 'Mobile number must be exactly 10 digits'
        }
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        trim: true,
        lowercase: true,
        validate: {
            validator: function (v) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: 'Please enter a valid email address'
        }
    },
    gstin: {
        type: String,
        trim: true,
        validate: {
            validator: function (v) {
                if (!v)
                    return true; // Optional field
                return v.length === 15; // Just check length
            },
            message: 'GSTIN must be exactly 15 characters'
        }
    },
    salesContact: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: [true, 'Company is required']
    },
    // Address Information
    address1: {
        type: String,
        trim: true,
        maxlength: [200, 'Address cannot exceed 200 characters']
    },
    googlePin: {
        type: String,
        trim: true,
        maxlength: [100, 'Google Pin cannot exceed 100 characters']
    },
    city: {
        type: String,
        trim: true,
        maxlength: [50, 'City cannot exceed 50 characters']
    },
    state: {
        type: String,
        trim: true,
        maxlength: [50, 'State cannot exceed 50 characters']
    },
    country: {
        type: String,
        trim: true,
        default: 'India',
        maxlength: [50, 'Country cannot exceed 50 characters']
    },
    pin: {
        type: String,
        trim: true,
        validate: {
            validator: function (v) {
                if (!v)
                    return true; // Optional field
                return /^\d{6}$/.test(v);
            },
            message: 'PIN code must be exactly 6 digits'
        }
    },
    // Financial fields (optional for future use)
    creditLimit: {
        type: Number,
        default: 0,
        min: 0
    },
    outstandingAmount: {
        type: Number,
        default: 0
    },
    advancePayment: {
        type: Number,
        default: 0,
        min: 0
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
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true }
});
// Auto-generate customer code before saving
customerSchema.pre('save', function () {
    return __awaiter(this, void 0, void 0, function* () {
        if (!this.customerCode) {
            const timestamp = Date.now().toString().slice(-8);
            const random = Math.random().toString(36).substr(2, 4).toUpperCase();
            this.customerCode = `CUST-${timestamp}-${random}`;
        }
    });
});
// Indexes for better query performance
customerSchema.index({ name: 1 });
customerSchema.index({ category: 1 });
customerSchema.index({ active: 1 });
customerSchema.index({ mobile: 1 });
customerSchema.index({ email: 1 });
customerSchema.index({ createdAt: -1 });
customerSchema.index({ companyId: 1 });
customerSchema.index({ salesContact: 1 });
exports.default = mongoose_1.default.model('Customer', customerSchema);
