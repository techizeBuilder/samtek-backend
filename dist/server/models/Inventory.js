"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerCategory = exports.Category = exports.Item = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const itemSchema = new mongoose_1.default.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    code: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    group: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        required: true,
        trim: true,
        enum: [
            'Purchase Machine',
            'Manufacturing Machine',
            'Raw Material',
            'Tool',
            'Asset',
            'Sheet Metal Material (Job Work)',
            'Machining Material (Job Work)',
            'Child Part Material (Sub-Assembly Parts)',
            'Assembly Material (Bought-Out Fitting Items)'
        ]
    },
    subCategory: {
        type: String,
        trim: true
    },
    batch: {
        type: String,
        trim: true
    },
    qty: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    unit: {
        type: String,
        required: true,
        trim: true
    },
    store: {
        type: String,
        trim: true
    },
    importance: {
        type: String,
        enum: ['Low', 'Normal', 'High', 'Critical'],
        default: 'Normal'
    },
    type: {
        type: String,
        required: true,
        enum: ['Product', 'Material', 'Spares', 'Assemblies']
    },
    stdCost: {
        type: Number,
        min: 0,
        default: 0
    },
    purchaseCost: {
        type: Number,
        min: 0,
        default: 0
    },
    salePrice: {
        type: Number,
        min: 0,
        default: 0
    },
    hsn: {
        type: String,
        trim: true
    },
    gst: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    currency: {
        type: String,
        default: 'INR'
    },
    unitType: {
        type: String,
        default: 'Nos'
    },
    mrp: {
        type: Number,
        min: 0,
        default: 0
    },
    internalManufacturing: {
        type: Boolean,
        default: false
    },
    purchase: {
        type: Boolean,
        default: true
    },
    description: {
        type: String,
        trim: true
    },
    internalNotes: {
        type: String,
        trim: true
    },
    minStock: {
        type: Number,
        min: 0,
        default: 0
    },
    leadTime: {
        type: Number,
        min: 0,
        default: 0
    },
    customerCategory: {
        type: String,
        required: false,
        trim: true,
        default: 'Retail'
    },
    tags: [{
            type: String,
            trim: true
        }],
    customerPrices: [{
            category: String,
            price: Number
        }],
    image: {
        type: String,
        trim: true,
        default: null
    },
    quantity: {
        type: String,
        trim: true,
        default: ""
    },
    dealerPrice: {
        type: Number,
        min: 0,
        default: 0
    },
    brochureUrl: {
        type: String,
        trim: true,
        default: null
    },
    videoUrl: {
        type: String,
        trim: true,
        default: null
    },
    uses: {
        type: String,
        trim: true
    },
    otherInfo: {
        type: String,
        trim: true
    },
    specifications: [{
            key: String,
            value: String
        }],
    minOrderQty: {
        type: Number,
        min: 0,
        default: 1
    },
    variant: {
        type: String,
        trim: true
    },
    order: {
        type: Number,
        default: 0
    },
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company'
    },
    // NEW: Product variants for quotation price list
    variants: [{
            name: {
                type: String,
                trim: true
            },
            capacity: {
                type: String,
                trim: true
            },
            motorPower: {
                type: String,
                trim: true
            },
            price: {
                type: Number,
                min: 0
            },
            code: {
                type: String,
                trim: true
            },
            specifications: {
                type: Map,
                of: String
            }
        }],
    // NEW: Product applications (for flour mill, etc.)
    applications: [{
            type: String,
            trim: true
        }],
    // NEW: Warranty information
    warranty: {
        period: {
            type: Number,
            default: 12 // months
        },
        type: {
            type: String,
            enum: ['Parts Only', 'Labor Only', 'Comprehensive'],
            default: 'Comprehensive'
        },
        terms: {
            type: String,
            trim: true
        }
    }
}, {
    timestamps: true
});
const categorySchema = new mongoose_1.default.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    subcategories: [{
            type: String,
            trim: true
        }]
}, {
    timestamps: true
});
const customerCategorySchema = new mongoose_1.default.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});
// Indexes for better performance
itemSchema.index({ name: 1, code: 1 });
itemSchema.index({ category: 1, subCategory: 1 });
itemSchema.index({ type: 1 });
itemSchema.index({ qty: 1, minStock: 1 });
itemSchema.index({ order: 1 });
itemSchema.index({ companyId: 1 });
itemSchema.index({ store: 1 });
exports.Item = mongoose_1.default.model('Item', itemSchema);
exports.Category = mongoose_1.default.model('Category', categorySchema);
exports.CustomerCategory = mongoose_1.default.model('CustomerCategory', customerCategorySchema);
