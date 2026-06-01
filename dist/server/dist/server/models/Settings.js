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
const settingsSchema = new mongoose_1.default.Schema({
    company: {
        name: {
            type: String,
            required: true,
            default: 'ManuERP Industries'
        },
        logo: {
            type: String
        },
        address: {
            street: String,
            city: String,
            state: String,
            zipCode: String,
            country: String
        },
        contact: {
            phone: String,
            email: String,
            website: String
        },
        gstNumber: String,
        panNumber: String
    },
    system: {
        currency: {
            type: String,
            default: 'INR'
        },
        timezone: {
            type: String,
            default: 'Asia/Kolkata'
        },
        dateFormat: {
            type: String,
            default: 'DD/MM/YYYY'
        },
        timeFormat: {
            type: String,
            default: '24'
        },
        language: {
            type: String,
            default: 'en'
        }
    },
    email: {
        smtpHost: String,
        smtpPort: {
            type: Number,
            default: 587
        },
        smtpUser: String,
        smtpPassword: String,
        fromEmail: String,
        fromName: String
    },
    modules: {
        dashboard: {
            type: Boolean,
            default: true
        },
        orders: {
            type: Boolean,
            default: true
        },
        manufacturing: {
            type: Boolean,
            default: true
        },
        dispatches: {
            type: Boolean,
            default: true
        },
        sales: {
            type: Boolean,
            default: true
        },
        accounts: {
            type: Boolean,
            default: true
        },
        inventory: {
            type: Boolean,
            default: true
        },
        customers: {
            type: Boolean,
            default: true
        },
        suppliers: {
            type: Boolean,
            default: true
        },
        purchases: {
            type: Boolean,
            default: true
        }
    },
    notifications: {
        lowStock: {
            type: Boolean,
            default: true
        },
        orderDelay: {
            type: Boolean,
            default: true
        },
        paymentDue: {
            type: Boolean,
            default: true
        },
        productionAlert: {
            type: Boolean,
            default: true
        },
        roleSettings: {
            type: mongoose_1.default.Schema.Types.Mixed,
            default: {}
        }
    },
    backup: {
        enabled: {
            type: Boolean,
            default: false
        },
        frequency: {
            type: String,
            enum: ['daily', 'weekly', 'monthly'],
            default: 'weekly'
        },
        time: {
            type: String,
            default: '02:00'
        }
    },
    theme: {
        defaultTheme: {
            type: String,
            enum: ['light', 'dark', 'system'],
            default: 'light'
        },
        allowUserThemeChange: {
            type: Boolean,
            default: true
        }
    }
}, {
    timestamps: true
});
// Ensure only one settings document exists
settingsSchema.statics.getSettings = function () {
    return __awaiter(this, void 0, void 0, function* () {
        let settings = yield this.findOne();
        if (!settings) {
            settings = yield this.create({});
        }
        return settings;
    });
};
exports.default = mongoose_1.default.model('Settings', settingsSchema);
